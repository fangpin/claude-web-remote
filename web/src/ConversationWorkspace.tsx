import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import ConfigView from './ConfigView';
import ConversationBlockList from './ConversationBlockList';
import Composer from './Composer';
import type { AppView, SessionListMode } from './AppShell';
import type { ClaudeCommand, SlashCommandToken } from './autocomplete';
import type { ConversationBlock } from './conversationBlocks';
import type { SessionInfo } from './types';
import type { EventConnectionState } from './useSessionEvents';

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
  error: string | null;
  connectionError: string | null;
  connectionState: EventConnectionState;
  eventRenderLimit: number;
  eventsRef: RefObject<HTMLDivElement | null>;
  hiddenEventCount: number;
  isAwaitingClaude: boolean;
  isComposerSession: boolean;
  isSending: boolean;
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
  onRetryConnection: () => void;
  onRetryTranscript: () => void;
  onUseEmptyStatePrompt: (prompt: string) => void;
};

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
  connectionError,
  connectionState,
  eventRenderLimit,
  eventsRef,
  hiddenEventCount,
  isAwaitingClaude,
  isComposerSession,
  isSending,
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
  onRetryConnection,
  onRetryTranscript,
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
      {activeSession ? (
        <>
          <header className="conversation-header">
            <div>
              <span className="eyebrow">{listMode === 'archived' ? 'Archived Claude session' : 'Remote Claude session'}</span>
              <h2>{activeSession.name || activeSession.cwd}</h2>
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
            <p className="deleted-note">This session is archived. Unarchive it before resuming work or sending messages.</p>
          )}
          {error && (
            <div role="alert" className="api-error-banner">
              <div>
                <strong>Something did not complete.</strong>
                <span>The chat is still here. Try the action again, or expand details if you need the raw response.</span>
              </div>
              <button type="button" onClick={onDismissError}>Dismiss</button>
              <details>
                <summary>Details</summary>
                <pre>{error}</pre>
              </details>
            </div>
          )}
          {connectionState === 'reconnecting' && (
            <div className="connection-note" role="status">Reconnecting to Claude...</div>
          )}
          {connectionState === 'error' && connectionError && (
            <div role="alert" className="api-error-banner connection-error">
              <div>
                <strong>Could not load the latest transcript.</strong>
                <span>Existing messages stay visible while you reconnect or reload the transcript.</span>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={onRetryTranscript}>Reload</button>
                {isComposerSession && <button type="button" onClick={onRetryConnection}>Reconnect</button>}
              </div>
              <details>
                <summary>Details</summary>
                <pre>{connectionError}</pre>
              </details>
            </div>
          )}
          <div className="events" ref={eventsRef}>
            <div className="conversation-content">
              {connectionState === 'loading' && activeBlocks.length === 0 && (
                <div className="conversation-skeleton" aria-label="Loading transcript">
                  <span />
                  <span />
                  <span />
                </div>
              )}
              {hiddenEventCount > 0 && (
                <div className="event-limit-note">
                  Showing latest {eventRenderLimit} events. {hiddenEventCount} older events hidden.
                </div>
              )}
              {connectionState !== 'loading' && activeBlocks.length === 0 && hiddenEventCount === 0 && (
                <section className="conversation-empty" aria-label="Conversation starter">
                  <span className="empty-eyebrow">{isComposerSession ? 'Ready when you are' : 'No transcript yet'}</span>
                  <h3>{isComposerSession ? 'What would you like Claude to do?' : 'This chat is quiet.'}</h3>
                  <p>
                    {isComposerSession
                      ? 'Ask Claude to inspect this repo, explain behavior, run tests, or make a change.'
                      : 'When this session has messages or tool output, they will appear here.'}
                  </p>
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
        <section className="empty-state conversation-empty" aria-label="No session selected">
          <span className="empty-eyebrow">Claude Remote Web</span>
          <h3>No chat selected.</h3>
          <p>Create a new chat or choose one from the sidebar to start working with Claude.</p>
        </section>
      )}
    </main>
  );
}
