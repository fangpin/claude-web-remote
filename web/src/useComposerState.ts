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
    const raw = window.localStorage.getItem(PROMPT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, PROMPT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function writePromptHistory(history: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(history.slice(0, PROMPT_HISTORY_LIMIT)));
  } catch {
    // localStorage can be unavailable in private or constrained browser contexts.
  }
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
  const draftBeforeHistoryRef = useRef<string | null>(null);

  const hasDraft = message.trim().length > 0;
  const canSend = isComposerSession && hasDraft && !isSending;
  const composerDisabledReason = !activeSession
    ? 'Select a session to send a message.'
    : listMode === 'archived' || activeSession.deletedAt
      ? 'Archived sessions are read-only. Unarchive to continue.'
      : activeSession.status === 'starting'
        ? 'Claude is starting. You can send once the session is ready.'
        : activeSession.status !== 'running'
          ? 'This session is stopped. Resume it to continue.'
          : '';
  const runtimeStatus = activeSession?.runtimeStatus ?? activeSession?.status;
  const sendStatusText = !isComposerSession
    ? composerDisabledReason
    : isSending
      ? 'Sending to Claude...'
      : isAwaitingClaude
        ? 'Claude is working...'
        : runtimeStatus === 'failed'
          ? 'Session failed'
          : runtimeStatus === 'stopped' || runtimeStatus === 'ended' || runtimeStatus === 'exited'
            ? 'Session stopped'
        : hasDraft
          ? 'Ready to send'
          : 'Message Claude';

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

  function rememberPrompt(prompt: string) {
    if (prompt.trim().length === 0) return;
    setPromptHistory((current) => {
      const nextHistory = [prompt, ...current.filter((item) => item !== prompt)].slice(0, PROMPT_HISTORY_LIMIT);
      writePromptHistory(nextHistory);
      return nextHistory;
    });
  }

  function restorePromptFromHistory(index: number | null) {
    const nextMessage = index === null ? draftBeforeHistoryRef.current ?? '' : promptHistory[index] ?? '';
    setHistoryIndex(index);
    setMessage(nextMessage);
    closeAutocomplete();
    requestAnimationFrame(() => {
      const input = messageInputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(nextMessage.length, nextMessage.length);
      resizeMessageInput(input);
    });
  }

  function canRecallPreviousPrompt(element: HTMLTextAreaElement) {
    if (promptHistory.length === 0) return false;
    if (historyIndex !== null) return true;
    if (message.trim().length === 0) return true;
    if (message.includes('\n')) return false;
    return element.selectionStart === 0 && element.selectionEnd === 0;
  }

  function recallPreviousPrompt(element: HTMLTextAreaElement) {
    if (!canRecallPreviousPrompt(element)) return false;
    const nextIndex = historyIndex === null ? 0 : Math.min(historyIndex + 1, promptHistory.length - 1);
    if (historyIndex === null) {
      draftBeforeHistoryRef.current = message;
    }
    restorePromptFromHistory(nextIndex);
    return true;
  }

  function recallNextPrompt() {
    if (historyIndex === null) return false;
    const nextIndex = historyIndex - 1;
    restorePromptFromHistory(nextIndex >= 0 ? nextIndex : null);
    return true;
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
      rememberPrompt(text);
      draftBeforeHistoryRef.current = null;
      setHistoryIndex(null);
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

  function completeActiveSuggestion() {
    const suggestion = suggestions[activeSuggestionIndex];
    if (!suggestion) return;
    completeSuggestion(suggestion);
  }

  function useEmptyStatePrompt(prompt: string) {
    setMessage(prompt);
    setHistoryIndex(null);
    draftBeforeHistoryRef.current = null;
    closeAutocomplete();
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
      messageInputRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function onMessageChange(value: string, element: HTMLTextAreaElement) {
    setMessage(value);
    setHistoryIndex(null);
    draftBeforeHistoryRef.current = null;
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

    if (event.key === 'ArrowUp' && !event.altKey && !event.ctrlKey && !event.metaKey && recallPreviousPrompt(event.currentTarget)) {
      event.preventDefault();
      return;
    }

    if (event.key === 'ArrowDown' && !event.altKey && !event.ctrlKey && !event.metaKey && recallNextPrompt()) {
      event.preventDefault();
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
