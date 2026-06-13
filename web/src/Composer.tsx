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

  return (
    <form
      className={`composer ${isComposerSession ? '' : 'composer-disabled'} ${isAwaitingClaude ? 'awaiting-claude' : ''}`}
      onSubmit={onSend}
      ref={composerRef}
      aria-label="Message composer"
    >
      <div className="composer-context" aria-label="Composer context">
        <span className="composer-status-pill">
          <span aria-hidden="true" className="composer-status-dot" />
          status: {isAwaitingClaude ? 'Waiting for Claude' : runtimeStatusLabels[activeSession.runtimeStatus ?? activeSession.status]}
        </span>
        <span title={activeSession.cwd}>cwd: {activeSession.cwd}</span>
        <span>permission: {activeSession.permissionMode}</span>
        {activeSession.worktree && <span title={activeSession.worktree.branch}>branch: {activeSession.worktree.branch}</span>}
        {activeSession.worktree && <span title={activeSession.worktree.sourceCwd}>source: {activeSession.worktree.sourceCwd}</span>}
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
              <strong>Commands</strong>
              <span>Use arrows, Tab, or Enter</span>
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
                <span className="autocomplete-command">{suggestion.name}</span>
                <span className="autocomplete-description">{suggestion.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="composer-actions">
        <span id="composer-send-status" aria-live="polite">{sendStatusText}</span>
        <div>
          {isComposerSession && (
            <button className="composer-stop-button" type="button" onClick={onStopSession}>Stop session</button>
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
