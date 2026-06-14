import { useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { getWorktreeDiff } from './api';
import ConfigView from './ConfigView';
import ConversationBlockList from './ConversationBlockList';
import Composer from './Composer';
import type { AppView, SessionListMode } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { ReviewSurface } from './activityTimeline';
import type { ConversationBlock } from './conversationBlocks';
import { getContinuityLabel, getSessionRuntimeLabel } from './sessionContinuity';
import type { EventConnectionState } from './useSessionEvents';
import type { ComposerContextAttachment, SessionInfo, WorktreeStatus } from './types';

type ApiError = {
  message: string;
  detail: string | null;
};

type Props = {
  activeBlocks: ConversationBlock[];
  activeSession: SessionInfo | null;
  activeSuggestionIndex: number;
  autocompleteOptionRefs: RefObject<Array<HTMLButtonElement | null>>;
  autocompleteToken: SlashCommandToken | null;
  canSend: boolean;
  contextAttachments: ComposerContextAttachment[];
  composerDisabledReason: string;
  composerRef: RefObject<HTMLFormElement | null>;
  emptyStatePrompts: string[];
  error: ApiError | null;
  eventConnectionError: string | null;
  eventConnectionState: EventConnectionState;
  visibleEventCount: number;
  eventsRef: RefObject<HTMLDivElement | null>;
  activeWorktreeStatus: WorktreeStatus | null;
  activeWorktreeStatusError: string | null;
  isWorktreeStatusLoading: boolean;
  canLoadOlderEvents: boolean;
  hiddenEventCount: number;
  reviewSurface: ReviewSurface | null;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  isSending: boolean;
  isSessionListLoading: boolean;
  isStartSurfaceOpen: boolean;
  listMode: SessionListMode;
  message: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  promptHistory: string[];
  sendStatusText: string;
  suggestions: ClaudeCommand[];
  view: AppView;
  startSurface: ReactNode;
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
  onDismissError: () => void;
  onRetryEvents: () => void;
  onLoadOlderEvents: () => void;
  onOpenReviewActivity: (review: ReviewSurface) => void;
  onRenameSession: (sessionId: string, name: string | null) => void;
  onUseEmptyStatePrompt: (prompt: string) => void;
};

function connectionLabel(state: EventConnectionState): string | null {
  if (state === 'connecting') return 'Loading conversation...';
  if (state === 'reconnecting') return 'Reconnecting...';
  if (state === 'error') return 'Conversation connection interrupted';
  return null;
}

function LoadingConversation() {
  return (
    <div className="conversation-loading" aria-label="Loading conversation">
      <span />
      <span />
      <span />
    </div>
  );
}

function worktreeStateLabel(status: WorktreeStatus | null, isLoading: boolean, error: string | null): string {
  if (isLoading) return 'Checking worktree...';
  if (error) return 'Status unavailable';
  if (!status) return 'Status pending';
  if (!status.dirty) return 'Clean';
  return `${status.changedFileCount} changed ${status.changedFileCount === 1 ? 'file' : 'files'}`;
}

function workspacePathForSession(session: SessionInfo): string {
  return session.worktree?.sourceCwd ?? session.cwd;
}

function workspaceBadgeForSession(session: SessionInfo): string | null {
  return session.worktree ? 'Isolated worktree' : null;
}

function shortWorkspaceName(session: SessionInfo): string {
  const path = workspacePathForSession(session);
  const normalized = path.replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? (normalized || 'Workspace');
}

function WorktreeStatusPanel({
  session,
  status,
  error,
  isLoading
}: {
  session: SessionInfo;
  status: WorktreeStatus | null;
  error: string | null;
  isLoading: boolean;
}) {
  const [diff, setDiff] = useState<string | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [isDiffLoading, setIsDiffLoading] = useState(false);

  if (!session.worktree) return null;
  const files = status?.files ?? [];
  const branch = status?.branch ?? session.worktree.branch;
  const baseRef = status?.baseRef ?? session.worktree.baseRef;

  async function loadDiff() {
    setIsDiffLoading(true);
    setDiffError(null);
    try {
      const result = await getWorktreeDiff(session.id);
      setDiff(result.diff || 'No unstaged diff.');
    } catch (err: unknown) {
      setDiffError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDiffLoading(false);
    }
  }

  function copyDeliveryContext() {
    const changedFiles = status?.files.map((file) => `${file.indexStatus}${file.worktreeStatus} ${file.path}`).join('\n') || 'No changed files';
    const content = [
      `Session: ${session.name || session.cwd}`,
      `Source: ${session.worktree?.sourceCwd ?? session.cwd}`,
      `Worktree: ${session.worktree?.worktreeCwd ?? session.cwd}`,
      `Branch: ${branch}`,
      baseRef ? `Base: ${baseRef}` : null,
      `State: ${worktreeStateLabel(status, isLoading, error)}`,
      '',
      'Changed files:',
      changedFiles,
      '',
      'Suggested next steps:',
      '- Review diff and test output.',
      '- Commit locally when satisfied.',
      '- Push/create PR only after explicit confirmation.'
    ].filter((line): line is string => line !== null).join('\n');
    void navigator.clipboard?.writeText(content);
  }

  return (
    <section className={`worktree-status-panel ${status?.dirty ? 'dirty' : ''}`} aria-label="Worktree status">
      <div className="worktree-status-heading">
        <span className={`worktree-state ${status?.dirty ? 'dirty' : 'clean'}`}>{worktreeStateLabel(status, isLoading, error)}</span>
        <span title={branch}>Branch: {branch}</span>
        {baseRef && <span title={baseRef}>Base: {baseRef}</span>}
        <details className="worktree-path-popover">
          <summary>Paths</summary>
          <dl className="worktree-paths">
            <div>
              <dt>Worktree</dt>
              <dd title={session.worktree.worktreeCwd}>{session.worktree.worktreeCwd}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd title={session.worktree.sourceCwd}>{session.worktree.sourceCwd}</dd>
            </div>
          </dl>
        </details>
        {status?.dirty && <button type="button" onClick={loadDiff} disabled={isDiffLoading}>{isDiffLoading ? 'Loading diff...' : 'View diff'}</button>}
        {session.worktree && <button type="button" onClick={copyDeliveryContext}>Copy delivery context</button>}
      </div>
      {error && <p className="worktree-warning">Unable to read worktree status: {error}</p>}
      {status?.dirty && (
        <p className="worktree-warning">This worktree has uncommitted changes. Stop only keeps it; cleanup is blocked until you commit, stash, or clean the changes.</p>
      )}
      {files.length > 0 && (
        <details className="worktree-files-details">
          <summary>
            <span>Changed files ({files.length})</span>
            <small>{files.length > 12 ? 'Scroll list' : 'Review paths'}</small>
          </summary>
          <ul className="worktree-file-list" aria-label="Changed files">
            {files.map((file) => (
              <li key={`${file.indexStatus}${file.worktreeStatus}:${file.path}`}>
                <code>{file.indexStatus}{file.worktreeStatus}</code>
                <span title={file.path}>{file.path}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {diffError && <p className="worktree-warning">Unable to load diff: {diffError}</p>}
      {diff && (
        <details className="worktree-diff-viewer" open>
          <summary>Worktree diff</summary>
          <pre>{diff}</pre>
        </details>
      )}
    </section>
  );
}

function ApiErrorBanner({
  error,
  onDismiss
}: {
  error: ApiError;
  onDismiss: () => void;
}) {
  return (
    <section role="alert" className="api-error">
      <div>
        <span className="state-kicker">Something needs attention</span>
        <p>{error.message}</p>
      </div>
      <button type="button" onClick={onDismiss}>Dismiss</button>
      {error.detail && (
        <details>
          <summary>Details</summary>
          <pre>{error.detail}</pre>
        </details>
      )}
    </section>
  );
}

function EditableSessionTitle({ session, onRename }: { session: SessionInfo; onRename: (sessionId: string, name: string | null) => void }) {
  const title = session.name || shortWorkspaceName(session);

  function rename() {
    const nextName = window.prompt('Rename chat', title);
    if (nextName === null) return;
    onRename(session.id, nextName.trim() || null);
  }

  return (
    <span className="editable-session-title">
      <h2>{title}</h2>
      <button type="button" onClick={rename} aria-label="Rename chat">Rename</button>
    </span>
  );
}

function SessionContinuitySummary({
  session,
  listMode
}: {
  session: SessionInfo;
  listMode: SessionListMode;
}) {
  const runtimeLabel = getSessionRuntimeLabel(session, listMode);
  const continuityLabel = getContinuityLabel(session, listMode);

  return (
    <div className="session-continuity-summary" aria-label="Session continuity">
      <span>{runtimeLabel}</span>
      {continuityLabel && <span>{continuityLabel}</span>}
    </div>
  );
}

export default function ConversationWorkspace({
  activeBlocks,
  activeSession,
  activeSuggestionIndex,
  autocompleteOptionRefs,
  autocompleteToken,
  canSend,
  composerDisabledReason,
  contextAttachments,
  composerRef,
  emptyStatePrompts,
  error,
  eventConnectionError,
  eventConnectionState,
  visibleEventCount,
  eventsRef,
  activeWorktreeStatus,
  activeWorktreeStatusError,
  isWorktreeStatusLoading,
  canLoadOlderEvents,
  hiddenEventCount,
  reviewSurface,
  isAwaitingClaude,
  isComposerSession,
  isSending,
  isSessionListLoading,
  isStartSurfaceOpen,
  listMode,
  message,
  messageInputRef,
  promptHistory,
  sendStatusText,
  suggestions,
  view,
  startSurface,
  onAddPathContextAttachment,
  onAddTextContextAttachment,
  onCompleteSuggestion,
  onMessageChange,
  onMessageKeyDown,
  onMessageSelect,
  onRemoveContextAttachment,
  onSend,
  onSetActiveSuggestionIndex,
  onUsePrompt,
  onDismissError,
  onRetryEvents,
  onLoadOlderEvents,
  onOpenReviewActivity,
  onRenameSession,
  onUseEmptyStatePrompt
}: Props) {
  if (view === 'config') {
    return (
      <main className="workspace config-workspace" aria-label="Configuration workspace">
        <ConfigView />
      </main>
    );
  }

  return (
    <main className={listMode === 'archived' ? 'workspace conversation-workspace with-deleted-note' : 'workspace conversation-workspace'} aria-label="Conversation workspace">
      {error && <ApiErrorBanner error={error} onDismiss={onDismissError} />}
      {(!activeSession || isStartSurfaceOpen) && !isSessionListLoading && listMode === 'active' ? (
        startSurface
      ) : activeSession ? (
        <>
          <header className="conversation-header">
            <div className="conversation-title-group">
              <div className="conversation-title-row">
                <span className="eyebrow">{listMode === 'archived' ? 'Archived' : 'Chat'}</span>
                <EditableSessionTitle session={activeSession} onRename={onRenameSession} />
                <SessionContinuitySummary session={activeSession} listMode={listMode} />
                {workspaceBadgeForSession(activeSession) && <span className="session-context-badge">{workspaceBadgeForSession(activeSession)}</span>}
                <details className="session-context-popover">
                  <summary>Details</summary>
                  <dl>
                    <div>
                      <dt>Workspace</dt>
                      <dd title={activeSession.cwd}>{activeSession.cwd}</dd>
                    </div>
                    <div>
                      <dt>Permission</dt>
                      <dd>{activeSession.permissionMode}</dd>
                    </div>
                    {activeSession.worktree && (
                      <>
                        <div>
                          <dt>Worktree</dt>
                          <dd title={activeSession.worktree.worktreeCwd}>{activeSession.worktree.worktreeCwd}</dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd title={activeSession.worktree.sourceCwd}>{activeSession.worktree.sourceCwd}</dd>
                        </div>
                        <div>
                          <dt>Branch</dt>
                          <dd>{activeWorktreeStatus?.branch ?? activeSession.worktree.branch}</dd>
                        </div>
                      </>
                    )}
                  </dl>
                </details>
              </div>
              <p title={workspacePathForSession(activeSession)}>{workspacePathForSession(activeSession)}</p>
            </div>
          </header>
          {listMode === 'archived' && (
            <p className="deleted-note">This session is archived and read-only. Unarchive it before resuming work or sending messages.</p>
          )}
          <WorktreeStatusPanel
            session={activeSession}
            status={activeWorktreeStatus}
            error={activeWorktreeStatusError}
            isLoading={isWorktreeStatusLoading}
          />
          <div className="events" ref={eventsRef}>
            <div className="conversation-content">
              {connectionLabel(eventConnectionState) && (
                <div className={`connection-state connection-state-${eventConnectionState}`} role={eventConnectionState === 'error' ? 'alert' : 'status'}>
                  <span aria-hidden="true" className="connection-dot" />
                  <span>{connectionLabel(eventConnectionState)}</span>
                  {eventConnectionState === 'error' && (
                    <>
                      <button type="button" onClick={onRetryEvents}>Retry</button>
                      {eventConnectionError && (
                        <details>
                          <summary>Details</summary>
                          <pre>{eventConnectionError}</pre>
                        </details>
                      )}
                    </>
                  )}
                </div>
              )}
              {(eventConnectionState === 'connecting' || eventConnectionState === 'reconnecting') && activeBlocks.length === 0 && hiddenEventCount === 0 && (
                <LoadingConversation />
              )}
              {canLoadOlderEvents && (
                <div className="event-limit-note">
                  <span>
                    Showing latest {visibleEventCount} events.
                    {hiddenEventCount > 0 ? ` ${hiddenEventCount} older events hidden.` : ''}
                    {' '}Scroll up to load earlier.
                  </span>
                  <button type="button" onClick={onLoadOlderEvents}>Load earlier</button>
                </div>
              )}
              {activeBlocks.length === 0 && !canLoadOlderEvents && hiddenEventCount === 0 && eventConnectionState !== 'connecting' && eventConnectionState !== 'reconnecting' && (
                <section className="conversation-empty" aria-label="Conversation starter">
                  <span className="empty-eyebrow">Ready when you are</span>
                  <h3>What would you like Claude to do?</h3>
                  <p>Ask Claude to inspect this repo, explain behavior, run tests, or make a change.</p>
                  {isComposerSession && (
                    <div className="empty-prompts" aria-label="Prompt suggestions">
                      {emptyStatePrompts.map((prompt) => (
                        <button key={prompt} type="button" onClick={() => onUseEmptyStatePrompt(prompt)}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              <ConversationBlockList blocks={activeBlocks} />
            </div>
          </div>
          <Composer
            activeSession={activeSession}
            activeSuggestionIndex={activeSuggestionIndex}
            autocompleteOptionRefs={autocompleteOptionRefs}
            autocompleteToken={autocompleteToken}
            canSend={canSend}
            composerDisabledReason={composerDisabledReason}
            composerRef={composerRef}
            contextAttachments={contextAttachments}
            isAwaitingClaude={isAwaitingClaude}
            isComposerSession={isComposerSession}
            isSending={isSending}
            message={message}
            messageInputRef={messageInputRef}
            promptHistory={promptHistory}
            sendStatusText={sendStatusText}
            suggestions={suggestions}
            onAddPathContextAttachment={onAddPathContextAttachment}
            onAddTextContextAttachment={onAddTextContextAttachment}
            onCompleteSuggestion={onCompleteSuggestion}
            onMessageChange={onMessageChange}
            onMessageKeyDown={onMessageKeyDown}
            onMessageSelect={onMessageSelect}
            onRemoveContextAttachment={onRemoveContextAttachment}
            onSend={onSend}
            onSetActiveSuggestionIndex={onSetActiveSuggestionIndex}
            onUsePrompt={onUsePrompt}
          />
        </>
      ) : (
        isSessionListLoading ? (
          <section className="empty-state empty-state-loading" aria-label="Loading sessions">
            <span className="state-kicker">Loading</span>
            <h2>Finding your chats...</h2>
            <LoadingConversation />
          </section>
        ) : (
          <section className="empty-state" aria-label="No session selected">
            <span className="state-kicker">{listMode === 'archived' ? 'Archive' : 'New chat'}</span>
            <h2>{listMode === 'archived' ? 'No archived chat selected.' : 'Choose a chat or start one.'}</h2>
            <p>{listMode === 'archived' ? 'Archived conversations are read-only once selected.' : 'Claude conversations stay focused here while setup and history sit to the side.'}</p>
          </section>
        )
      )}
    </main>
  );
}
