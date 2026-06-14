import { useEffect, useMemo, useRef, useState } from 'react';
import { eventsUrl, listSessionEvents } from './api';
import { buildConversationBlocks } from './conversationBlocks';
import { extractSessionPlan } from './sessionPlan';
import type { SessionInfo, UiEvent } from './types';

export type EventConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error' | 'closed';

type ObjectPayload = Record<string, unknown>;
type PendingMessage = {
  id: number;
  text: string;
};

type SessionConnection = {
  state: EventConnectionState;
  error: string | null;
};

const MAX_STORED_EVENTS_PER_SESSION = 500;

type UseSessionEventsOptions = {
  activeId: string | null;
  activeSession: SessionInfo | null;
  eventRenderLimit: number;
  isActiveSessionMode: boolean;
  isComposerSession: boolean;
  refreshTasks: () => Promise<void>;
  refreshSessionTasks: (sessionId: string) => Promise<void>;
};

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

function isAssistantProgressEvent(event: UiEvent): boolean {
  if (event.kind === 'assistant') return true;
  if (!isObjectPayload(event.payload)) return false;
  const type = event.payload.type;
  if (type === 'message_start' || type === 'message_stop') return true;
  if (type === 'content_block_start') {
    const contentBlock = event.payload.content_block;
    return isObjectPayload(contentBlock) && contentBlock.type === 'text';
  }
  if (type === 'content_block_delta') {
    const delta = event.payload.delta;
    return isObjectPayload(delta) && delta.type === 'text_delta';
  }
  return false;
}

function latestPersistedEventId(events: UiEvent[]): number {
  return events.reduce((latest, event) => (event.id > latest ? event.id : latest), 0);
}

function trimStoredEvents(events: UiEvent[]): UiEvent[] {
  if (events.length <= MAX_STORED_EVENTS_PER_SESSION) return events;
  const pendingEvents = events.filter((event) => event.id < 0);
  const persistedEvents = events.filter((event) => event.id >= 0).slice(-MAX_STORED_EVENTS_PER_SESSION);
  return [...persistedEvents, ...pendingEvents];
}

function mergeEvents(current: UiEvent[], incoming: UiEvent[] = []): UiEvent[] {
  if (incoming.length === 0) return trimStoredEvents(current);
  const incomingUserTexts = new Set(
    incoming
      .map(userEventText)
      .filter((text): text is string => Boolean(text))
      .map(normalizedMessageText)
  );
  const pendingEvents = current.filter((event) => {
    if (event.id >= 0) return false;
    const text = userEventText(event);
    return !text || !incomingUserTexts.has(normalizedMessageText(text));
  });
  const byId = new Map<number, UiEvent>();
  for (const event of current) {
    if (event.id >= 0) byId.set(event.id, event);
  }
  for (const event of incoming) {
    if (event.id >= 0) byId.set(event.id, event);
  }
  return trimStoredEvents([...Array.from(byId.values()).sort((a, b) => a.id - b.id), ...pendingEvents]);
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
  const [connections, setConnections] = useState<Record<string, SessionConnection>>({});
  const [awaitingClaudeSessionIds, setAwaitingClaudeSessionIds] = useState<Set<string>>(() => new Set());
  const [pendingEventId, setPendingEventId] = useState<number | null>(null);
  const [connectionRetryToken, setConnectionRetryToken] = useState(0);
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
  const activeBlockEventIds = useMemo(
    () => activeBlocks.flatMap((block) => block.eventIds),
    [activeBlocks]
  );
  const activePlan = useMemo(
    () => extractSessionPlan(activeEvents),
    [activeEvents]
  );
  const defaultActiveConnection: SessionConnection = {
    state: activeSession && isActiveSessionMode && (activeSession.status === 'running' || activeSession.status === 'starting') ? 'connecting' : 'idle',
    error: null
  };
  const activeConnection: SessionConnection = activeId
    ? connections[activeId] ?? defaultActiveConnection
    : defaultActiveConnection;
  const hiddenEventCount = activeEvents.length - visibleEvents.length;
  const isAwaitingClaude = activeId ? awaitingClaudeSessionIds.has(activeId) : false;

  function setConnection(sessionId: string, update: Partial<SessionConnection>) {
    setConnections((current) => {
      const previous = current[sessionId] ?? { state: 'idle' as const, error: null };
      return {
        ...current,
        [sessionId]: {
          ...previous,
          ...update
        }
      };
    });
  }

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

  async function loadOlderEvents() {
    if (!activeId) return;
    const current = events[activeId] ?? [];
    const firstPersistedId = current.find((event) => event.id >= 0)?.id;
    if (!firstPersistedId) return;
    const older = await listSessionEvents(activeId, 0, eventRenderLimit, firstPersistedId);
    setEvents((latest) => ({
      ...latest,
      [activeId]: mergeEvents(older, latest[activeId] ?? [])
    }));
  }

  function retryActiveEvents() {
    if (!activeId) return;
    setConnection(activeId, { state: events[activeId]?.length ? 'reconnecting' : 'connecting', error: null });
    setConnectionRetryToken((token) => token + 1);
  }

  useEffect(() => {
    if (!activeSession) return;
    const sessionId = activeSession.id;
    let cancelled = false;

    async function loadHistory() {
      try {
        const afterId = latestPersistedEventId(events[sessionId] ?? []);
        const loaded = await listSessionEvents(sessionId, afterId, afterId > 0 ? undefined : eventRenderLimit);
        if (cancelled || activeIdRef.current !== sessionId) return;
        setEvents((current) => ({
          ...current,
          [sessionId]: mergeEvents(current[sessionId] ?? [], loaded)
        }));
      } catch (error) {
        if (cancelled || activeIdRef.current !== sessionId) return;
        const detail = error instanceof Error ? error.message : 'Could not load this session transcript.';
        setConnection(sessionId, { state: 'error', error: detail });
      }
    }

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.updatedAt, connectionRetryToken]);

  useEffect(() => {
    if (!activeSession || !isActiveSessionMode) {
      return;
    }
    if (activeSession.status !== 'running' && activeSession.status !== 'starting') {
      setConnection(activeSession.id, { state: 'idle', error: null });
      return;
    }
    const sessionId = activeSession.id;
    let socket: WebSocket | null = null;
    let didOpen = false;
    let hadSocketError = false;
    setConnection(sessionId, { state: events[sessionId]?.length ? 'reconnecting' : 'connecting', error: null });
    const connectTimeoutId = window.setTimeout(() => {
      if (activeIdRef.current !== sessionId) return;
      const afterId = latestPersistedEventId(events[sessionId] ?? []);
      socket = new WebSocket(eventsUrl(sessionId, afterId));
      socket.onopen = () => {
        didOpen = true;
        setConnection(sessionId, { state: 'open', error: null });
      };
      socket.onmessage = (message) => {
        let event: UiEvent;
        try {
          event = JSON.parse(message.data) as UiEvent;
        } catch {
          setConnection(sessionId, { state: 'error', error: 'Claude sent an unreadable event. Reconnect by selecting the session again.' });
          return;
        }
        if (event.kind === 'error' && (typeof event.id !== 'number' || typeof event.sessionId !== 'string')) {
          setConnection(sessionId, { state: 'error', error: textFromEventPayload(event.payload) ?? 'Could not load this session transcript.' });
          return;
        }
        if (event.kind === 'user' && replaceMatchingPendingMessage(sessionId, event)) {
          markAwaitingClaude(sessionId, true);
          return;
        }
        if (isAssistantProgressEvent(event) || event.kind === 'error') {
          markAwaitingClaude(sessionId, false);
        }
        setEvents((current) => ({
          ...current,
          [sessionId]: mergeEvents(current[sessionId] ?? [], [event])
        }));
        void refreshTasks();
        void refreshSessionTasks(sessionId);
      };
      socket.onerror = () => {
        hadSocketError = true;
        setConnection(sessionId, { state: 'error', error: 'Connection to Claude events was interrupted.' });
      };
      socket.onclose = () => {
        if (hadSocketError) return;
        setConnection(sessionId, {
          state: didOpen ? 'closed' : 'error',
          error: didOpen ? null : 'Could not connect to Claude events.'
        });
      };
    }, 0);
    return () => {
      window.clearTimeout(connectTimeoutId);
      socket?.close();
    };
  }, [activeSession?.id, activeSession?.status, activeSession?.updatedAt, connectionRetryToken, isActiveSessionMode, refreshTasks, refreshSessionTasks]);

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
    activeBlockEventIds,
    activeConnection,
    activeEvents,
    activePlan,
    addPendingMessage,
    events,
    eventsRef,
    hiddenEventCount,
    isAwaitingClaude,
    loadOlderEvents,
    markAwaitingClaude,
    removePendingMessage,
    removeSessionEvents,
    retryActiveEvents,
    setPendingEventId,
    visibleEvents
  };
}
