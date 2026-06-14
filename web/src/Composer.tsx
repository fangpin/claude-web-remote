import { useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
import { runtimeStatusLabels } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { ComposerContextAttachment, SessionInfo } from './types';

type ComposerContextDetail = {
  label: string;
  value: string;
};

function basename(path: string): string {
  const normalized = path.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? (normalized || 'Workspace');
}

function composerTargetLabel(session: SessionInfo): string {
  const target = basename(session.worktree?.sourceCwd ?? session.cwd);
  return session.worktree ? `Target: ${target} · worktree` : `Target: ${target}`;
}

function composerTargetTitle(session: SessionInfo): string {
  return session.worktree?.sourceCwd ?? session.cwd;
}

function composerContextDetails(session: SessionInfo): ComposerContextDetail[] {
  return [
    { label: 'cwd', value: session.cwd },
    { label: 'permission', value: session.permissionMode },
    ...(session.worktree
      ? [
          { label: 'source', value: session.worktree.sourceCwd },
          { label: 'worktree', value: session.worktree.worktreeCwd },
          { label: 'branch', value: session.worktree.branch }
        ]
      : [])
  ];
}

type Props = {
  activeSession: SessionInfo;
  activeSuggestionIndex: number;
  autocompleteOptionRefs: RefObject<Array<HTMLButtonElement | null>>;
  autocompleteToken: SlashCommandToken | null;
  canSend: boolean;
  contextAttachments: ComposerContextAttachment[];
  composerDisabledReason: string;
  composerRef: RefObject<HTMLFormElement | null>;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  isSending: boolean;
  message: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  promptHistory: string[];
  sendStatusText: string;
  suggestions: ClaudeCommand[];
  onAddPathContextAttachment: (path: string) => void;
  onAddTextContextAttachment: (name: string, content: string) => void;
  onCompleteSuggestion: (suggestion: ClaudeCommand) => void;
  onMessageChange: (value: string, element: HTMLTextAreaElement) => void;
  onMessageKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMessageSelect: (value: string, cursor: number | null) => void;
  onRemoveContextAttachment: (id: string) => void;
  onSend: (event: FormEvent) => void;
  onSetActiveSuggestionIndex: (index: number) => void;
  onUsePrompt: (prompt: string) => void;
};

export default function Composer({
  activeSession,
  activeSuggestionIndex,
  autocompleteOptionRefs,
  autocompleteToken,
  canSend,
  composerDisabledReason,
  contextAttachments,
  composerRef,
  isAwaitingClaude,
  isComposerSession,
  isSending,
  message,
  messageInputRef,
  promptHistory,
  sendStatusText,
  suggestions,
  onAddPathContextAttachment,
  onAddTextContextAttachment,
  onCompleteSuggestion,
  onMessageChange,
  onMessageKeyDown,
  onMessageSelect,
  onRemoveContextAttachment,
  onSend,
  onSetActiveSuggestionIndex,
  onUsePrompt
}: Props) {
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [pathContext, setPathContext] = useState('');
  const [textContextName, setTextContextName] = useState('');
  const [textContextContent, setTextContextContent] = useState('');
  const hasAutocomplete = suggestions.length > 0 && autocompleteToken;
  const runtimeStatus = activeSession.runtimeStatus ?? activeSession.status;
  const statusLabel = isAwaitingClaude ? 'Claude is working' : runtimeStatusLabels[runtimeStatus];
  const contextDetails = composerContextDetails(activeSession);

  function addPathContext() {
    if (!pathContext.trim()) return;
    onAddPathContextAttachment(pathContext);
    setPathContext('');
    setAttachmentMenuOpen(false);
  }

  function addTextContext() {
    if (!textContextContent.trim()) return;
    onAddTextContextAttachment(textContextName, textContextContent);
    setTextContextName('');
    setTextContextContent('');
    setAttachmentMenuOpen(false);
  }

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
          {statusLabel}
        </span>
        <span className="composer-context-chip">Permission: {activeSession.permissionMode}</span>
        <span className="composer-context-chip" title={composerTargetTitle(activeSession)}>{composerTargetLabel(activeSession)}</span>
        <details className="composer-context-menu">
          <summary aria-label="Show session context details">
            <span>Details</span>
          </summary>
          <dl>
            {contextDetails.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd title={item.value}>{item.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
      {contextAttachments.length > 0 && (
        <div className="context-attachment-chips" aria-label="Context attachments">
          {contextAttachments.map((attachment) => {
            const label = attachment.type === 'path' ? `@${attachment.path}` : attachment.name;
            if (attachment.type === 'text') {
              const lineCount = attachment.content.trim() ? attachment.content.trim().split(/\r?\n/).length : 0;
              return (
                <details className="context-snippet-card" key={attachment.id}>
                  <summary>
                    <span>
                      <strong>{attachment.name}</strong>
                      <small>{lineCount} {lineCount === 1 ? 'line' : 'lines'} · {attachment.content.length} chars</small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${label}`}
                      onClick={(event) => {
                        event.preventDefault();
                        onRemoveContextAttachment(attachment.id);
                      }}
                    >
                      ×
                    </button>
                  </summary>
                  <pre>{attachment.content}</pre>
                </details>
              );
            }
            return (
              <span className="context-attachment-chip" key={attachment.id} title={label}>
                <span className="context-attachment-kind">Repo path</span>
                <span className="context-attachment-label">{label}</span>
                <button
                  type="button"
                  aria-label={`Remove ${label}`}
                  onClick={() => onRemoveContextAttachment(attachment.id)}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
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
                <strong>{autocompleteToken.query === '/' ? 'Command palette' : 'Commands'}</strong>
                <span>{suggestions.length} available</span>
              </div>
              <span>Arrows, Tab, Enter</span>
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
                <span className="autocomplete-option-main">
                  <span className="autocomplete-command">{suggestion.name}</span>
                  <span className="autocomplete-category">{suggestion.category}</span>
                </span>
                <span className="autocomplete-description">{suggestion.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="composer-hints" aria-label="Composer shortcuts">
        <span>Enter to send</span>
        <span>Shift Enter for newline</span>
        <span>/ for commands</span>
        <span>↑ for history</span>
      </div>
      <div className="composer-actions">
        <span id="composer-send-status" aria-live="polite">{sendStatusText}</span>
        <div>
          <div className="composer-history-menu">
            <button
              className="composer-history-button"
              type="button"
              disabled={!isComposerSession || promptHistory.length === 0}
              aria-expanded={historyMenuOpen}
              aria-haspopup="menu"
              onClick={() => setHistoryMenuOpen((open) => !open)}
            >
              History
            </button>
            {historyMenuOpen && (
              <div className="prompt-history-popover" role="menu" aria-label="Prompt history">
                {promptHistory.slice(0, 8).map((prompt, index) => (
                  <button
                    key={`${prompt}-${index}`}
                    type="button"
                    role="menuitem"
                    title={prompt}
                    onClick={() => {
                      onUsePrompt(prompt);
                      setHistoryMenuOpen(false);
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="composer-attachment-menu">
            <button
              className="composer-attach-button"
              type="button"
              disabled={!isComposerSession}
              aria-expanded={attachmentMenuOpen}
              aria-haspopup="dialog"
              aria-label="Add context reference"
              title="Add repo path or pasted text context"
              onClick={() => setAttachmentMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">+</span>
            </button>
            {attachmentMenuOpen && (
              <div className="context-attachment-popover" role="dialog" aria-label="Add context reference">
                <div className="context-attachment-copy">
                  <strong>Add context reference</strong>
                  <span>References are sent as prompt context. Browser files are not uploaded. Use paths relative to the session cwd.</span>
                </div>
                <div className="context-attachment-section">
                  <label htmlFor="path-context-input">
                    Repo path
                    <input
                      id="path-context-input"
                      value={pathContext}
                      placeholder="web/src/Composer.tsx"
                      onChange={(event) => setPathContext(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addPathContext();
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={addPathContext} disabled={!pathContext.trim()}>Add path</button>
                </div>
                <div className="context-attachment-section">
                  <label htmlFor="text-context-name-input">
                    Text context name
                    <input
                      id="text-context-name-input"
                      value={textContextName}
                      placeholder="Error log, stack trace, notes"
                      onChange={(event) => setTextContextName(event.target.value)}
                    />
                  </label>
                  <label htmlFor="text-context-content-input">
                    Pasted text
                    <textarea
                      id="text-context-content-input"
                      value={textContextContent}
                      placeholder="Paste text to include with the prompt"
                      onChange={(event) => setTextContextContent(event.target.value)}
                      rows={4}
                    />
                  </label>
                  <button type="button" onClick={addTextContext} disabled={!textContextContent.trim()}>Add pasted text</button>
                </div>
              </div>
            )}
          </div>
          <button
            className="send-button"
            type="submit"
            disabled={!canSend}
            aria-label={isSending ? 'Sending message' : 'Send'}
            aria-describedby="composer-send-status"
            title={isSending ? 'Sending message' : isAwaitingClaude ? 'Send another message while Claude is working' : 'Send message'}
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
