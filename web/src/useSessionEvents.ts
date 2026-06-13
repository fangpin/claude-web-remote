import { useEffect, useMemo, useRef, useState } from 'react';
import { eventsUrl, listSessionEvents } from './api';
import { buildConversationBlocks } from './conversationBlocks';
import { extractSessionPlan } from './sessionPlan';
import type { SessionInfo, UiEvent } from './types';

type ObjectPayload = Record<string, unknown>;
type PendingMessage = {
  id: number;
  text: string;
};

type UseSessionEventsOptions = {
  activeId: string | null;
  activeSession: SessionInfo | null;
  eventRenderLimit: number;
  isActiveSessionMode: boolean;
  isComposerSession: boolean;
  refreshTasks: () => Promise<void>;
  refreshSessionTasks: (sessionId: string) => Promise<void>;
};

export type EventConnectionState = 'idle' | 'loading' | 'connecting' | 'connected' | 'reconnecting' | 'error';

function isObjectPayload(value: unknown): value is ObjectPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!Array.isArray(value)) return null;
  const text = value
    .map((entry) => (isObjectPayload(entry) && entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null))
    .filter((entry): entry is string => Boolean(entry?.trim()))
    .join('\n');
  return text || null;
}

function textFromEventPayload(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (!isObjectPayload(payload)) return null;
  const directMessage = payload.message;
  if (typeof directMessage === 'string' && directMessage.trim()) return directMessage;
  const directText = payload.text;
  if (typeof directText === 'string' && directText.trim()) return directText;
  const directContent = textFromContent(payload.content);
  if (directContent) return directContent;
  if (isObjectPayload(directMessage)) {
    if (typeof directMessage.text === 'string' && directMessage.text.trim()) return directMessage.text;
    return textFromContent(directMessage.content);
  }
  return null;
}

function normalizedMessageText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function userEventText(event: UiEvent): string | null {
  return event.kind === 'user' ? textFromEventPayload(event.payload) : null;
}

export function useSessionEvents({
  activeId,
  activeSession,
  eventRenderLimit,
  isActiveSessionMode,
  isComposerSession,
  refreshTasks,
  refreshSessionTasks
}: UseSessionEventsOptions) {
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [awaitingClaudeSessionIds, setAwaitingClaudeSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingEventId, setPendingEventId] = useState<number | null>(null);
  const [connectionState, setConnectionState] = useState<EventConnectionState>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [transcriptRetryToken, setTranscriptRetryToken] = useState(0);
  const [socketRetryToken, setSocketRetryToken] = useState(0);
  const activeIdRef = useRef<string | null>(null);
  const eventsRef = useRef<HTMLDivElement | null>(null);
  const pendingMessagesRef = useRef<Record<string, PendingMessage[]>>({});
  activeIdRef.current = activeId;

  const activeEvents = useMemo(
    () => (activeId ? events[activeId] ?? [] : []),
    [activeId, events]
  );
  const visibleEvents = useMemo(
    () => activeEvents.slice(-eventRenderLimit),
    [activeEvents, eventRenderLimit]
  );
  const activeBlocks = useMemo(
    () => buildConversationBlocks(visibleEvents),
    [visibleEvents]
  );
  const activePlan = useMemo(
    () => extractSessionPlan(activeEvents),
    [activeEvents]
  );
  const hiddenEventCount = activeEvents.length - visibleEvents.length;
  const isAwaitingClaude = activeId ? awaitingClaudeSessionIds.has(activeId) : false;

  function addPendingMessage(sessionId: string, text: string): number {
    const eventId = -Date.now();
    const pendingEvent: UiEvent = {
      id: eventId,
      sessionId,
      time: new Date().toISOString(),
      kind: 'user',
      payload: { message: text, pending: true }
    };
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: [...(pendingMessagesRef.current[sessionId] ?? []), { id: eventId, text }]
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), pendingEvent]
    }));
    return eventId;
  }

  function removePendingMessage(sessionId: string, eventId: number) {
    const remaining = (pendingMessagesRef.current[sessionId] ?? []).filter((item) => item.id !== eventId);
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: remaining
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).filter((event) => event.id !== eventId)
    }));
  }

  function replaceMatchingPendingMessage(sessionId: string, event: UiEvent): boolean {
    const text = userEventText(event);
    if (!text) return false;
    const pendingMessages = pendingMessagesRef.current[sessionId] ?? [];
    const matching = pendingMessages.find((item) => normalizedMessageText(item.text) === normalizedMessageText(text));
    if (!matching) return false;
    const remaining = pendingMessages.filter((item) => item.id !== matching.id);
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: remaining
    };
    setEvents((current) => ({
      ...current,
      [sessionId]: (current[sessionId] ?? []).map((currentEvent) => (currentEvent.id === matching.id ? event : currentEvent))
    }));
    return true;
  }

  function markAwaitingClaude(sessionId: string, awaiting: boolean) {
    setAwaitingClaudeSessionIds((current) => {
      const next = new Set(current);
      if (awaiting) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  }

  function removeSessionEvents(sessionId: string) {
    setEvents((current) => {
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
    pendingMessagesRef.current = {
      ...pendingMessagesRef.current,
      [sessionId]: []
    };
    markAwaitingClaude(sessionId, false);
  }

  function mergeSessionEvents(sessionId: string, nextEvents: UiEvent[]) {
    setEvents((current) => {
      const byId = new Map<number, UiEvent>();
      for (const event of current[sessionId] ?? []) byId.set(event.id, event);
      for (const event of nextEvents) byId.set(event.id, event);
      return {
        ...current,
        [sessionId]: [...byId.values()].sort((a, b) => a.id - b.id)
      };
    });
  }

  function retryTranscript() {
    setTranscriptRetryToken((token) => token + 1);
  }

  function retryConnection() {
    setSocketRetryToken((token) => token + 1);
  }

  useEffect(() => {
    if (!activeId) {
      setConnectionState('idle');
      setConnectionError(null);
      return;
    }

    let cancelled = false;
    const sessionId = activeId;
    setConnectionState('loading');
    setConnectionError(null);

    async function loadTranscript() {
      try {
        const loadedEvents = await listSessionEvents(sessionId);
        if (cancelled || activeIdRef.current !== sessionId) return;
        mergeSessionEvents(sessionId, loadedEvents);
        if (isActiveSessionMode && (activeSession?.status === 'running' || activeSession?.status === 'starting')) {
          setConnectionState((current) => (current === 'loading' ? 'connecting' : current));
        } else {
          setConnectionState('idle');
        }
      } catch (err: unknown) {
        if (cancelled || activeIdRef.current !== sessionId) return;
        setConnectionError(err instanceof Error ? err.message : String(err));
        setConnectionState('error');
      }
    }

    void loadTranscript();

    return () => {
      cancelled = true;
    };
  }, [activeId, activeSession?.status, isActiveSessionMode, transcriptRetryToken]);

  useEffect(() => {
    if (!activeSession || !isActiveSessionMode) return;
    if (activeSession.status !== 'running' && activeSession.status !== 'starting') return;
    const sessionId = activeSession.id;
    let socket: WebSocket | null = null;
    let didOpen = false;
    let closingIntentionally = false;
    setConnectionState((current) => (current === 'loading' ? current : 'connecting'));
    setConnectionError(null);
    const connectTimeoutId = window.setTimeout(() => {
      if (activeIdRef.current !== sessionId) return;
      const afterId = (events[sessionId] ?? []).reduce((latest, event) => (event.id > latest ? event.id : latest), 0);
      socket = new WebSocket(eventsUrl(sessionId, afterId));
      socket.onopen = () => {
        didOpen = true;
        if (activeIdRef.current !== sessionId) return;
        setConnectionState('connected');
        setConnectionError(null);
      };
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as UiEvent;
        if (event.kind === 'error' && (typeof event.id !== 'number' || !event.sessionId)) {
          const payload = isObjectPayload(event.payload) ? event.payload : {};
          setConnectionError(String(payload.message ?? payload.error ?? 'The event stream reported an error.'));
          setConnectionState('error');
          return;
        }
        if (event.kind === 'user' && replaceMatchingPendingMessage(sessionId, event)) {
          markAwaitingClaude(sessionId, true);
          return;
        }
        if (event.kind === 'assistant' || event.kind === 'error') {
          markAwaitingClaude(sessionId, false);
        }
        mergeSessionEvents(sessionId, [event]);
        void refreshTasks();
        void refreshSessionTasks(sessionId);
      };
      socket.onerror = () => {
        if (activeIdRef.current !== sessionId) return;
        setConnectionError('The live event stream could not stay connected.');
        setConnectionState('error');
      };
      socket.onclose = () => {
        if (closingIntentionally || activeIdRef.current !== sessionId) return;
        setConnectionState(didOpen ? 'reconnecting' : 'error');
        if (!didOpen) setConnectionError('The live event stream could not connect.');
      };
    }, 0);
    return () => {
      closingIntentionally = true;
      window.clearTimeout(connectTimeoutId);
      socket?.close();
    };
  }, [activeSession?.id, activeSession?.status, activeSession?.updatedAt, isActiveSessionMode, refreshTasks, refreshSessionTasks, socketRetryToken, transcriptRetryToken]);

  useEffect(() => {
    if (!activeId || isComposerSession) return;
    markAwaitingClaude(activeId, false);
  }, [activeId, isComposerSession]);

  useEffect(() => {
    const eventsElement = eventsRef.current;
    if (!eventsElement) return;
    eventsElement.scrollTop = eventsElement.scrollHeight;
  }, [activeId, visibleEvents.length]);

  useEffect(() => {
    if (pendingEventId === null) return;
    const element = document.getElementById(`event-${pendingEventId}`);
    if (!element) return;
    if (typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'center' });
    }
    element.classList.add('event-highlight');
    window.setTimeout(() => element.classList.remove('event-highlight'), 1600);
    setPendingEventId(null);
  }, [pendingEventId, activeId, events]);

  return {
    activeBlocks,
    activeEvents,
    activePlan,
    addPendingMessage,
    events,
    eventsRef,
    connectionError,
    connectionState,
    hiddenEventCount,
    isAwaitingClaude,
    markAwaitingClaude,
    removePendingMessage,
    removeSessionEvents,
    retryConnection,
    retryTranscript,
    setPendingEventId,
    visibleEvents
  };
}
