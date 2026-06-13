import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { runtimeStatusLabels } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { SessionInfo } from './types';

type Props = {
  activeSession: SessionInfo;
  activeSuggestionIndex: number;
  autocompleteOptionRefs: RefObject<Array<HTMLButtonElement | null>>;
  autocompleteToken: SlashCommandToken | null;
  canSend: boolean;
  composerDisabledReason: string;
  composerRef: RefObject<HTMLFormElement | null>;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  isSending: boolean;
  message: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  sendStatusText: string;
  suggestions: ClaudeCommand[];
  onCompleteSuggestion: (suggestion: ClaudeCommand) => void;
  onMessageChange: (value: string, element: HTMLTextAreaElement) => void;
  onMessageKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMessageSelect: (value: string, cursor: number | null) => void;
  onSend: (event: FormEvent) => void;
  onSetActiveSuggestionIndex: (index: number) => void;
  onStopSession: () => void;
};

export default function Composer({
  activeSession,
  activeSuggestionIndex,
  autocompleteOptionRefs,
  autocompleteToken,
  canSend,
  composerDisabledReason,
  composerRef,
  isAwaitingClaude,
  isComposerSession,
  isSending,
  message,
  messageInputRef,
  sendStatusText,
  suggestions,
  onCompleteSuggestion,
  onMessageChange,
  onMessageKeyDown,
  onMessageSelect,
  onSend,
  onSetActiveSuggestionIndex,
  onStopSession
}: Props) {
  const hasAutocomplete = suggestions.length > 0 && autocompleteToken;
  const contextItems = [
    { label: 'cwd', value: activeSession.cwd, title: activeSession.cwd },
    { label: 'permission', value: activeSession.permissionMode },
    ...(activeSession.worktree
      ? [
          { label: 'branch', value: activeSession.worktree.branch, title: activeSession.worktree.branch },
          { label: 'source', value: activeSession.worktree.sourceCwd, title: activeSession.worktree.sourceCwd }
        ]
      : [])
  ];
  const statusLabel = isAwaitingClaude
    ? 'Claude is working'
    : runtimeStatusLabels[activeSession.runtimeStatus ?? activeSession.status];
  const paletteTitle = autocompleteToken?.query === '/' ? 'Command palette' : 'Commands';

  return (
    <form
      className={`composer ${isComposerSession ? '' : 'composer-disabled'} ${isAwaitingClaude ? 'awaiting-claude' : ''}`}
      onSubmit={onSend}
      ref={composerRef}
      aria-label="Message composer"
    >
      <div className="composer-context" aria-label="Composer context">
        <div className="composer-context-desktop" aria-hidden={false}>
          <span className="composer-status-pill">
            <span aria-hidden="true" className="composer-status-dot" />
            status: {statusLabel}
          </span>
          {contextItems.map((item) => (
            <span key={item.label} title={item.title}>{item.label}: {item.value}</span>
          ))}
        </div>
        <details className="composer-context-compact">
          <summary>
            <span className="composer-status-pill">
              <span aria-hidden="true" className="composer-status-dot" />
              {statusLabel}
            </span>
            <span>Context</span>
          </summary>
          <dl>
            {contextItems.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd title={item.title}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      <div className="composer-input">
        <label className="sr-only" htmlFor="message-input">Message</label>
        <textarea
          id="message-input"
          ref={messageInputRef}
          value={message}
          aria-label="Message"
          aria-activedescendant={hasAutocomplete ? `autocomplete-option-${activeSuggestionIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={hasAutocomplete ? 'command-autocomplete' : undefined}
          disabled={!isComposerSession}
          placeholder={isComposerSession ? 'Message Claude...' : composerDisabledReason}
          onChange={(event) => onMessageChange(event.target.value, event.currentTarget)}
          onSelect={(event) => onMessageSelect(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={onMessageKeyDown}
          rows={1}
        />
        {hasAutocomplete && (
          <div id="command-autocomplete" className="autocomplete" role="listbox" aria-label="Claude command suggestions">
            <div className="autocomplete-header">
              <div>
                <strong>{paletteTitle}</strong>
                <span>{suggestions.length} available</span>
              </div>
              <span>Arrow keys, Tab, Enter, Esc</span>
            </div>
            {suggestions.map((suggestion, index) => (
              <button
                key={suggestion.name}
                id={`autocomplete-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeSuggestionIndex}
                className={index === activeSuggestionIndex ? 'autocomplete-option active' : 'autocomplete-option'}
                ref={(element) => {
                  autocompleteOptionRefs.current[index] = element;
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onSetActiveSuggestionIndex(index)}
                onClick={() => onCompleteSuggestion(suggestion)}
              >
                <span className="autocomplete-command-row">
                  <span className="autocomplete-command">{suggestion.name}</span>
                  <span className="autocomplete-category">{suggestion.category}</span>
                </span>
                <span className="autocomplete-description">{suggestion.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="composer-actions">
        <span id="composer-send-status" aria-live="polite">{sendStatusText}</span>
        <div>
          <button
            className="composer-attachment-button"
            type="button"
            disabled
            title="Attach file context coming soon"
            aria-label="Attach file context coming soon"
          >
            <span className="sr-only">Attach file context coming soon</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
              <path d="M5.1 12.9a3.1 3.1 0 0 1 0-4.38l4.78-4.78a2.15 2.15 0 1 1 3.04 3.04l-5.15 5.15a1.25 1.25 0 0 1-1.77-1.77l4.46-4.46.9.9-4.46 4.46a.02.02 0 0 0 0 .03.02.02 0 0 0 .03 0l5.15-5.15a.88.88 0 1 0-1.25-1.25L6 9.43a1.83 1.83 0 1 0 2.59 2.59l5.05-5.05.9.9-5.05 5.05a3.1 3.1 0 0 1-4.39-.02Z" />
            </svg>
          </button>
          {isComposerSession && (
            <button className="composer-stop-button" type="button" onClick={onStopSession} aria-label="Stop session">Stop</button>
          )}
          <button
            className="send-button"
            type="submit"
            disabled={!canSend}
            aria-label={isSending ? 'Sending message' : 'Send'}
            aria-describedby="composer-send-status"
            title={isSending ? 'Sending message' : 'Send message'}
          >
            <span className="sr-only">{isSending ? 'Sending message' : 'Send'}</span>
            <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
              <path d="M8 2.25 13.25 7.5l-.9.9L8.63 4.68V14H7.37V4.68L3.65 8.4l-.9-.9L8 2.25Z" />
            </svg>
          </button>
        </div>
      </div>
    </form>
  );
}
