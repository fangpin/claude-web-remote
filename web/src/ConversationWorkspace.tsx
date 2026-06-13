import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import ConfigView from './ConfigView';
import ConversationBlockList from './ConversationBlockList';
import Composer from './Composer';
import type { AppView, SessionListMode } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { ConversationBlock } from './conversationBlocks';
import type { EventConnectionState } from './useSessionEvents';
import type { SessionInfo, WorktreeStatus } from './types';

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
  composerDisabledReason: string;
  composerRef: RefObject<HTMLFormElement | null>;
  emptyStatePrompts: string[];
  error: ApiError | null;
  eventConnectionError: string | null;
  eventConnectionState: EventConnectionState;
  eventRenderLimit: number;
  eventsRef: RefObject<HTMLDivElement | null>;
  activeWorktreeStatus: WorktreeStatus | null;
  activeWorktreeStatusError: string | null;
  isWorktreeStatusLoading: boolean;
  hiddenEventCount: number;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  isSending: boolean;
  isSessionListLoading: boolean;
  listMode: SessionListMode;
  message: string;
  messageInputRef: RefObject<HTMLTextAreaElement | null>;
  sendStatusText: string;
  suggestions: ClaudeCommand[];
  view: AppView;
  actions: ReactNode;
  onCompleteSuggestion: (suggestion: ClaudeCommand) => void;
  onMessageChange: (value: string, element: HTMLTextAreaElement) => void;
  onMessageKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMessageSelect: (value: string, cursor: number | null) => void;
  onSend: (event: FormEvent) => void;
  onSetActiveSuggestionIndex: (index: number) => void;
  onStopSession: () => void;
  onDismissError: () => void;
  onRetryEvents: () => void;
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
  if (!session.worktree) return null;
  const files = status?.files.slice(0, 8) ?? [];
  const extraFileCount = Math.max(0, (status?.files.length ?? 0) - files.length);
  const branch = status?.branch ?? session.worktree.branch;
  const baseRef = status?.baseRef ?? session.worktree.baseRef;

  return (
    <section className={`worktree-status-panel ${status?.dirty ? 'dirty' : ''}`} aria-label="Worktree status">
      <div className="worktree-status-heading">
        <span className={`worktree-state ${status?.dirty ? 'dirty' : 'clean'}`}>{worktreeStateLabel(status, isLoading, error)}</span>
        <span>Branch: {branch}</span>
        {baseRef && <span>Base: {baseRef}</span>}
      </div>
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
      {error && <p className="worktree-warning">Unable to read worktree status: {error}</p>}
      {status?.dirty && (
        <p className="worktree-warning">This worktree has uncommitted changes. Stop only keeps it; cleanup is blocked until you commit, stash, or clean the changes.</p>
      )}
      {files.length > 0 && (
        <ul className="worktree-file-list" aria-label="Changed files">
          {files.map((file) => (
            <li key={`${file.indexStatus}${file.worktreeStatus}:${file.path}`}>
              <code>{file.indexStatus}{file.worktreeStatus}</code>
              <span title={file.path}>{file.path}</span>
            </li>
          ))}
          {extraFileCount > 0 && <li className="worktree-more">+ {extraFileCount} more</li>}
        </ul>
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

export default function ConversationWorkspace({
  activeBlocks,
  activeSession,
  activeSuggestionIndex,
  autocompleteOptionRefs,
  autocompleteToken,
  canSend,
  composerDisabledReason,
  composerRef,
  emptyStatePrompts,
  error,
  eventConnectionError,
  eventConnectionState,
  eventRenderLimit,
  eventsRef,
  activeWorktreeStatus,
  activeWorktreeStatusError,
  isWorktreeStatusLoading,
  hiddenEventCount,
  isAwaitingClaude,
  isComposerSession,
  isSending,
  isSessionListLoading,
  listMode,
  message,
  messageInputRef,
  sendStatusText,
  suggestions,
  view,
  actions,
  onCompleteSuggestion,
  onMessageChange,
  onMessageKeyDown,
  onMessageSelect,
  onSend,
  onSetActiveSuggestionIndex,
  onStopSession,
  onDismissError,
  onRetryEvents,
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
      {activeSession ? (
        <>
          <header className="conversation-header">
            <div>
              <span className="eyebrow">{listMode === 'archived' ? 'Archived Claude session' : 'Remote Claude session'}</span>
              <h2>{activeSession.name || activeSession.cwd}</h2>
              <p title={activeSession.cwd}>{activeSession.cwd}</p>
              {activeSession.worktree && (
                <div className="worktree-meta">
                  <span>Worktree: {activeSession.worktree.worktreeCwd}</span>
                  <span>Source: {activeSession.worktree.sourceCwd}</span>
                  <span>Branch: {activeWorktreeStatus?.branch ?? activeSession.worktree.branch}</span>
                </div>
              )}
            </div>
            {actions}
          </header>
          {listMode === 'archived' && (
            <p className="deleted-note">This session is archived. Unarchive it before resuming work or sending messages.</p>
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
              {hiddenEventCount > 0 && (
                <div className="event-limit-note">
                  Showing latest {eventRenderLimit} events. {hiddenEventCount} older events hidden.
                </div>
              )}
              {activeBlocks.length === 0 && hiddenEventCount === 0 && eventConnectionState !== 'connecting' && eventConnectionState !== 'reconnecting' && (
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
            isAwaitingClaude={isAwaitingClaude}
            isComposerSession={isComposerSession}
            isSending={isSending}
            message={message}
            messageInputRef={messageInputRef}
            sendStatusText={sendStatusText}
            suggestions={suggestions}
            onCompleteSuggestion={onCompleteSuggestion}
            onMessageChange={onMessageChange}
            onMessageKeyDown={onMessageKeyDown}
            onMessageSelect={onMessageSelect}
            onSend={onSend}
            onSetActiveSuggestionIndex={onSetActiveSuggestionIndex}
            onStopSession={onStopSession}
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
