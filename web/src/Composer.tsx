import { useId, useState, type FormEvent, type KeyboardEvent, type RefObject } from 'react';
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

function composerProjectLabel(session: SessionInfo): string {
  return `Project: ${basename(session.worktree?.sourceCwd ?? session.cwd)}`;
}

function composerProjectTitle(session: SessionInfo): string {
  const path = session.worktree?.sourceCwd ?? session.cwd;
  return session.worktree ? `${path} (worktree)` : path;
}

function composerContextDetails(session: SessionInfo, statusLabel: string): ComposerContextDetail[] {
  return [
    { label: 'Project', value: session.worktree?.sourceCwd ?? session.cwd },
    ...(session.worktree
      ? [
          { label: 'Worktree', value: session.worktree.worktreeCwd },
          { label: 'Source', value: session.worktree.sourceCwd },
          { label: 'Branch', value: session.worktree.branch }
        ]
      : [{ label: 'Workspace', value: session.cwd }]),
    { label: 'Permission', value: session.permissionMode },
    { label: 'Status', value: statusLabel }
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
  onStopSession: () => void;
  onSetActiveSuggestionIndex: (index: number) => void;
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
  onStopSession,
  onSetActiveSuggestionIndex
}: Props) {
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [pathContext, setPathContext] = useState('');
  const [textContextName, setTextContextName] = useState('');
  const [textContextContent, setTextContextContent] = useState('');
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const [isMessageFocused, setIsMessageFocused] = useState(false);
  const projectContextId = useId();
  const hasAutocomplete = suggestions.length > 0 && autocompleteToken;
  const runtimeStatus = activeSession.runtimeStatus ?? activeSession.status;
  const statusLabel = isAwaitingClaude ? 'Claude is working' : runtimeStatusLabels[runtimeStatus];
  const contextDetails = composerContextDetails(activeSession, statusLabel);
  const showHints = isMessageFocused && message.trim().length === 0;
  const primaryActionIsStop = isAwaitingClaude && !isSending;

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
      <div aria-label="Composer context">
        <div className="composer-context">
          <span className="composer-status-pill">
            <span aria-hidden="true" className="composer-status-dot" />
            {statusLabel}
          </span>
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
          onFocus={() => setIsMessageFocused(true)}
          onBlur={() => setIsMessageFocused(false)}
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
      {showHints && (
        <div className="composer-hints" aria-label="Composer shortcuts">
          <span>Enter send</span>
          <span>Shift Enter newline</span>
          <span>/ commands</span>
          <span>↑ history</span>
        </div>
      )}
      <div className="composer-actions">
        <span id="composer-send-status" aria-live="polite">{sendStatusText}</span>
        <div>
          <div className="composer-attachment-menu">
            <button
              className="composer-attach-button"
              type="button"
              disabled={!isComposerSession}
              aria-expanded={attachmentMenuOpen}
              aria-haspopup="dialog"
              aria-label="Add context"
              title="Add repo path or pasted text"
              onClick={() => setAttachmentMenuOpen((open) => !open)}
            >
              <span aria-hidden="true">+</span>
            </button>
            {attachmentMenuOpen && (
              <div className="context-attachment-popover" role="dialog" aria-label="Add context">
                <div className="context-attachment-copy">
                  <strong>Add context</strong>
                  <span>Add a repo path or paste text for Claude to use.</span>
                </div>
                <div className="context-attachment-section">
                  <label htmlFor="path-context-input">
                    Add repo path
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
                    Paste text
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
          <div className="composer-project-menu">
            <button
              className="composer-project-button"
              type="button"
              aria-expanded={contextMenuOpen}
              aria-controls={contextMenuOpen ? projectContextId : undefined}
              aria-label="Show project context"
              title={composerProjectTitle(activeSession)}
              onClick={() => setContextMenuOpen((open) => !open)}
            >
              <span>{composerProjectLabel(activeSession)}</span>
              {activeSession.worktree && <small>worktree</small>}
            </button>
            {contextMenuOpen && (
              <dl id={projectContextId} className="composer-project-popover">
                {contextDetails.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd title={item.value}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <button
            className={primaryActionIsStop ? 'send-button composer-stop-button' : 'send-button'}
            type={primaryActionIsStop ? 'button' : 'submit'}
            disabled={primaryActionIsStop ? !isComposerSession : !canSend}
            aria-label={primaryActionIsStop ? 'Stop' : isSending ? 'Sending message' : 'Send'}
            aria-describedby="composer-send-status"
            title={primaryActionIsStop ? 'Stop Claude' : isSending ? 'Sending message' : isAwaitingClaude ? 'Claude is working' : 'Send message'}
            onClick={primaryActionIsStop ? onStopSession : undefined}
          >
            <span className="sr-only">{primaryActionIsStop ? 'Stop' : isSending ? 'Sending message' : 'Send'}</span>
            {primaryActionIsStop ? (
              <span aria-hidden="true" className="composer-stop-icon" />
            ) : (
              <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
                <path d="M8 2.25 13.25 7.5l-.9.9L8.63 4.68V14H7.37V4.68L3.65 8.4l-.9-.9L8 2.25Z" />
              </svg>
            )}
          </button>
        </div>
      </div>
      </div>
    </form>
  );
}
