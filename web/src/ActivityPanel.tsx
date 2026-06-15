import type { ActivityItem, ActivityStatus } from './activityTimeline';
import type { SessionInfo } from './types';

const ACTIVITY_LIMIT = 24;

const statusLabels: Record<ActivityStatus, string> = {
  running: 'Running',
  waiting: 'Waiting',
  failed: 'Failed',
  done: 'Done'
};

const statusOrder: ActivityStatus[] = ['running', 'waiting', 'failed', 'done'];

type Props = {
  activities?: ActivityItem[];
  activeSession: SessionInfo | null;
  waitingMessage: string | null;
  onSelectActivity: (activity: ActivityItem) => void;
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(durationMs?: number): string | null {
  if (durationMs === undefined) return null;
  if (durationMs < 1000) return '<1s';
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function activityCount(activities: ActivityItem[], status: ActivityStatus): number {
  return activities.filter((activity) => activity.status === status).length;
}

function resultLine(activity: ActivityItem): string | null {
  if (activity.status === 'running') return 'Waiting for tool result';
  if (activity.status === 'waiting') return 'Needs attention';
  return activity.resultSummary ?? null;
}

function ActivityCard({ activity, onSelectActivity }: { activity: ActivityItem; onSelectActivity: (activity: ActivityItem) => void }) {
  const time = formatTime(activity.finishedAt ?? activity.startedAt);
  const duration = formatDuration(activity.durationMs);
  const result = resultLine(activity);

  return (
    <button
      type="button"
      className={`activity-card ${activity.status}`}
      title={`Open activity: ${activity.name}`}
      onClick={() => onSelectActivity(activity)}
    >
      <span className="activity-card-main">
        <span className="activity-card-header">
          <span className="activity-name">{activity.name}</span>
          <span className="activity-status">
            <span className="activity-status-dot" aria-hidden="true" />
            {statusLabels[activity.status]}
          </span>
        </span>
        {activity.summary && <span className="activity-summary">{activity.summary}</span>}
        <span className="activity-meta">
          {time && <span>{time}</span>}
          {duration && <span>{duration}</span>}
          {activity.transcriptHidden && <span>Transcript summary</span>}
        </span>
        {result && <span className="activity-result">{result}</span>}
        {activity.isPermissionLike && (
          <span className="activity-review-note">Review payload available; decision controls are not exposed by this server yet.</span>
        )}
      </span>
      <span className="activity-card-jump" aria-hidden="true">Open</span>
    </button>
  );
}

export default function ActivityPanel({ activities = [], activeSession, waitingMessage, onSelectActivity }: Props) {
  const visibleActivities = activities.slice(0, ACTIVITY_LIMIT);
  const hiddenCount = activities.length - visibleActivities.length;
  const latestPermissionActivity = activities.find((activity) => activity.isPermissionLike && ['running', 'waiting'].includes(activity.status));

  return (
    <section className="activity-panel" aria-label="Activity timeline">
      <header className="activity-panel-header">
        <div>
          <h3>Current run</h3>
          <p>
            {statusOrder.map((status) => `${activityCount(activities, status)} ${statusLabels[status].toLowerCase()}`).join(' · ')}
          </p>
        </div>
      </header>
      {waitingMessage && (
        <section className={`waiting-surface ${latestPermissionActivity ? 'permission-like' : ''}`} aria-label="Waiting status">
          <h4>Claude is waiting</h4>
          <p>{waitingMessage}</p>
          {latestPermissionActivity && (
            <button type="button" onClick={() => onSelectActivity(latestPermissionActivity)}>
              Review payload
            </button>
          )}
        </section>
      )}
      {!activeSession ? (
        <div className="activity-empty">
          <span className="activity-empty-title">No session selected</span>
          <span>Select a chat to see what Claude has been doing.</span>
        </div>
      ) : activities.length === 0 ? (
        <div className="activity-empty">
          <span className="activity-empty-title">No activity yet</span>
          <span>Claude's tool calls and permission waits will appear here.</span>
        </div>
      ) : (
        <div className="activity-list">
          {hiddenCount > 0 && (
            <p className="activity-limit-note">
              Showing latest {ACTIVITY_LIMIT}; {hiddenCount} older hidden.
            </p>
          )}
          {visibleActivities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} onSelectActivity={onSelectActivity} />
          ))}
        </div>
      )}
    </section>
  );
}
