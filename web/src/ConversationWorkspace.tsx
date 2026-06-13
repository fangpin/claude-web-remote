import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import ConfigView from './ConfigView';
import ConversationBlockList from './ConversationBlockList';
import Composer from './Composer';
import type { AppView, SessionListMode } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { ReviewSurface } from './activityTimeline';
import type { ConversationBlock } from './conversationBlocks';
import { getContinuityLabel, getSessionRuntimeLabel } from './sessionContinuity';
import type { EventConnectionState } from './useSessionEvents';
import type { ComposerContextAttachment, SessionInfo } from './types';

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
  eventRenderLimit: number;
  eventsRef: RefObject<HTMLDivElement | null>;
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
  sendStatusText: string;
  suggestions: ClaudeCommand[];
  view: AppView;
  actions: ReactNode;
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

function ReviewCard({ review, onOpenActivity }: { review: ReviewSurface; onOpenActivity?: () => void }) {
  return (
    <section className={`review-card ${review.activity?.reviewKind ?? 'waiting'}`} aria-label="Claude needs your review">
      <div className="review-card-heading">
        <div>
          <span className="state-kicker">Action review</span>
          <h3>{review.title}</h3>
        </div>
        {review.activity && onOpenActivity && (
          <button type="button" onClick={onOpenActivity}>Open activity</button>
        )}
      </div>
      <p>{review.message}</p>
      <dl className="review-facts">
        {review.actionName && (
          <div>
            <dt>Action</dt>
            <dd>{review.actionName}</dd>
          </div>
        )}
        {review.actionSummary && (
          <div>
            <dt>Input</dt>
            <dd>{review.actionSummary}</dd>
          </div>
        )}
        <div>
          <dt>Working directory</dt>
          <dd>{review.cwd}</dd>
        </div>
        <div>
          <dt>Permission mode</dt>
          <dd>{review.permissionMode}</dd>
        </div>
        {review.riskHint && (
          <div>
            <dt>Risk hint</dt>
            <dd>{review.riskHint}</dd>
          </div>
        )}
      </dl>
      <p className="review-limitation">{review.limitation}</p>
    </section>
  );
}

export { ReviewCard };
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
  eventRenderLimit,
  eventsRef,
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
  sendStatusText,
  suggestions,
  view,
  actions,
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
      {(!activeSession || isStartSurfaceOpen) && !isSessionListLoading && listMode === 'active' ? (
        startSurface
      ) : activeSession ? (
        <>
          <header className="conversation-header">
            <div>
              <span className="eyebrow">{listMode === 'archived' ? 'Archived Claude session' : 'Remote Claude session'}</span>
              <h2>{activeSession.name || activeSession.cwd}</h2>
              <SessionContinuitySummary session={activeSession} listMode={listMode} />
              <p title={activeSession.cwd}>{activeSession.cwd}</p>
              {activeSession.worktree && (
                <div className="worktree-meta">
                  <span>Source: {activeSession.worktree.sourceCwd}</span>
                  <span>Branch: {activeSession.worktree.branch}</span>
                </div>
              )}
            </div>
            {actions}
          </header>
          {listMode === 'archived' && (
            <p className="deleted-note">This session is archived and read-only. Unarchive it before resuming work or sending messages.</p>
          )}
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
              {reviewSurface && <ReviewCard review={reviewSurface} />}
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
            contextAttachments={contextAttachments}
            isAwaitingClaude={isAwaitingClaude}
            isComposerSession={isComposerSession}
            isSending={isSending}
            message={message}
            messageInputRef={messageInputRef}
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
