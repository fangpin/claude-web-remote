import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { sendInput } from './api';
import type { SessionListMode } from './AppShell';
import { applyCommandCompletion, findSlashCommandToken, getCommandSuggestions, type ClaudeCommand, type SlashCommandToken } from './autocomplete';
import type { SessionInfo } from './types';

const MESSAGE_INPUT_MAX_HEIGHT = 220;
const PROMPT_HISTORY_KEY = 'claude-remote-web:prompt-history';
const PROMPT_HISTORY_LIMIT = 50;

type UseComposerStateOptions = {
  activeId: string | null;
  activeSession: SessionInfo | null;
  addPendingMessage: (sessionId: string, text: string) => number;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  listMode: SessionListMode;
  markAwaitingClaude: (sessionId: string, awaiting: boolean) => void;
  removePendingMessage: (sessionId: string, eventId: number) => void;
  setError: (error: string | null) => void;
  setSessions: Dispatch<SetStateAction<SessionInfo[]>>;
};

function resizeMessageInput(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = 'auto';
  const contentHeight = element.scrollHeight;
  if (contentHeight > 0) {
    element.style.height = `${Math.min(contentHeight, MESSAGE_INPUT_MAX_HEIGHT)}px`;
  } else {
    element.style.height = '';
  }
  element.style.overflowY = contentHeight > MESSAGE_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';
}

function readPromptHistory(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROMPT_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
}

function writePromptHistory(history: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(history.slice(0, PROMPT_HISTORY_LIMIT)));
  } catch {
    // History is a convenience feature; storage failures should never block sending.
  }
}

function savePromptToHistory(prompt: string): string[] {
  const trimmed = prompt.trim();
  if (!trimmed) return readPromptHistory();
  const nextHistory = [trimmed, ...readPromptHistory().filter((item) => item !== trimmed)].slice(0, PROMPT_HISTORY_LIMIT);
  writePromptHistory(nextHistory);
  return nextHistory;
}

function canRecallPreviousPrompt(value: string, cursor: number | null | undefined): boolean {
  if (value.length === 0) return true;
  if (cursor === null || cursor === undefined) return false;
  return !value.includes('\n') && cursor === 0;
}

function canRecallNextPrompt(value: string, cursor: number | null | undefined): boolean {
  if (value.length === 0) return true;
  if (cursor === null || cursor === undefined) return false;
  return !value.includes('\n') && cursor === value.length;
}

export function useComposerState({
  activeId,
  activeSession,
  addPendingMessage,
  isAwaitingClaude,
  isComposerSession,
  listMode,
  markAwaitingClaude,
  removePendingMessage,
  setError,
  setSessions
}: UseComposerStateOptions) {
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const autocompleteOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [autocompleteToken, setAutocompleteToken] = useState<SlashCommandToken | null>(null);
  const [suggestions, setSuggestions] = useState<ClaudeCommand[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [promptHistory, setPromptHistory] = useState<string[]>(() => readPromptHistory());
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const historyDraftRef = useRef('');

  const hasDraft = message.trim().length > 0;
  const canSend = isComposerSession && hasDraft && !isSending;
  const composerDisabledReason = !activeSession
    ? 'Select a session to send a message.'
    : listMode === 'archived' || activeSession.deletedAt
      ? 'Archived sessions are read-only. Unarchive to continue.'
      : activeSession.status === 'starting'
        ? 'Claude is starting. You can send once the session is ready.'
        : activeSession.status === 'failed' || activeSession.runtimeStatus === 'failed'
          ? 'This session failed. Restart to continue.'
        : activeSession.status !== 'running'
          ? 'This session is stopped. Resume it to continue.'
          : '';
  const sendStatusText = !isComposerSession
    ? composerDisabledReason
    : isSending
      ? 'Sending to Claude...'
      : isAwaitingClaude
        ? 'Claude is working...'
        : hasDraft
          ? 'Ready to send'
          : activeSession?.status === 'failed' || activeSession?.runtimeStatus === 'failed'
            ? 'Session failed. Restart to continue.'
            : 'Ready for a prompt';

  const hasAutocomplete = useMemo(
    () => suggestions.length > 0 && autocompleteToken,
    [autocompleteToken, suggestions.length]
  );

  function refreshAutocomplete(value: string, cursor: number | null | undefined) {
    const token = findSlashCommandToken(value, cursor);
    const nextSuggestions = token ? getCommandSuggestions(token.query) : [];
    setAutocompleteToken(token && nextSuggestions.length > 0 ? token : null);
    setSuggestions(nextSuggestions);
    setActiveSuggestionIndex(0);
  }

  function closeAutocomplete() {
    setAutocompleteToken(null);
    setSuggestions([]);
    setActiveSuggestionIndex(0);
    autocompleteOptionRefs.current = [];
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !canSend) return;
    const sessionId = activeId;
    const text = message;
    const pendingEventId = addPendingMessage(sessionId, text);
    setError(null);
    setIsSending(true);
    markAwaitingClaude(sessionId, true);
    setMessage('');
    closeAutocomplete();
    try {
      const updatedSession = await sendInput(sessionId, text);
      if (updatedSession) {
        setSessions((current) => current.map((session) => session.id === updatedSession.id ? updatedSession : session));
      }
      setPromptHistory(savePromptToHistory(text));
      setHistoryIndex(null);
      historyDraftRef.current = '';
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      removePendingMessage(sessionId, pendingEventId);
      markAwaitingClaude(sessionId, false);
      setMessage(text);
      refreshAutocomplete(text, text.length);
    } finally {
      setIsSending(false);
    }
  }

  function completeSuggestion(suggestion: ClaudeCommand) {
    if (!autocompleteToken) return;
    const completed = applyCommandCompletion(message, autocompleteToken, suggestion.name);
    setMessage(completed.value);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(completed.cursor, completed.cursor);
    });
  }

  function recallPromptHistory(direction: 'previous' | 'next') {
    const history = promptHistory.length > 0 ? promptHistory : readPromptHistory();
    if (history.length === 0) return;

    const currentIndex = historyIndex;
    let nextIndex: number | null;
    if (direction === 'previous') {
      if (currentIndex === null) {
        historyDraftRef.current = message;
        nextIndex = 0;
      } else {
        nextIndex = Math.min(currentIndex + 1, history.length - 1);
      }
    } else if (currentIndex === null) {
      return;
    } else if (currentIndex <= 0) {
      nextIndex = null;
    } else {
      nextIndex = currentIndex - 1;
    }

    const nextMessage = nextIndex === null ? historyDraftRef.current : history[nextIndex];
    setPromptHistory(history);
    setHistoryIndex(nextIndex);
    setMessage(nextMessage);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(nextMessage.length, nextMessage.length);
      resizeMessageInput(messageInputRef.current);
    });
  }

  function completeActiveSuggestion() {
    const suggestion = suggestions[activeSuggestionIndex];
    if (!suggestion) return;
    completeSuggestion(suggestion);
  }

  function useEmptyStatePrompt(prompt: string) {
    setMessage(prompt);
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function onMessageChange(value: string, element: HTMLTextAreaElement) {
    setMessage(value);
    setHistoryIndex(null);
    historyDraftRef.current = '';
    resizeMessageInput(element);
    refreshAutocomplete(value, element.selectionStart);
  }

  function onMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as unknown as {
      isComposing?: boolean;
      nativeEvent?: { isComposing?: boolean };
      keyCode?: number;
      which?: number;
    };
    const isComposing =
      nativeEvent.isComposing === true ||
      nativeEvent.nativeEvent?.isComposing === true ||
      (event as unknown as { isComposing?: boolean }).isComposing === true ||
      nativeEvent.keyCode === 229 ||
      nativeEvent.which === 229;

    if (suggestions.length > 0 && autocompleteToken) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        setActiveSuggestionIndex(0);
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        setActiveSuggestionIndex(suggestions.length - 1);
        return;
      }

      if ((event.key === 'Tab' || event.key === 'Enter') && !event.shiftKey && !isComposing) {
        event.preventDefault();
        completeActiveSuggestion();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeAutocomplete();
        return;
      }
    }

    if (event.key === 'ArrowUp' && (historyIndex !== null || canRecallPreviousPrompt(message, event.currentTarget.selectionStart))) {
      event.preventDefault();
      recallPromptHistory('previous');
      return;
    }

    if (event.key === 'ArrowDown' && (historyIndex !== null || canRecallNextPrompt(message, event.currentTarget.selectionStart))) {
      event.preventDefault();
      recallPromptHistory('next');
      return;
    }

    if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  useEffect(() => {
    if (!activeId) return;
    composerRef.current?.scrollIntoView({ block: 'end' });
  }, [activeId]);

  useEffect(() => {
    resizeMessageInput(messageInputRef.current);
  }, [message, isComposerSession]);

  useEffect(() => {
    autocompleteOptionRefs.current[activeSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeSuggestionIndex, suggestions]);

  return {
    activeSuggestionIndex,
    autocompleteOptionRefs,
    autocompleteToken,
    canSend,
    composerDisabledReason,
    composerRef,
    hasAutocomplete,
    isSending,
    message,
    messageInputRef,
    sendStatusText,
    suggestions,
    completeSuggestion,
    onMessageChange,
    onMessageKeyDown,
    onMessageSelect: refreshAutocomplete,
    onSend,
    setActiveSuggestionIndex,
    useEmptyStatePrompt
  };
}
