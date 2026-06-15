import { useState } from 'react';
import type { PendingPermissionRequest, PermissionCapability } from './types';

type Props = {
  permission: PendingPermissionRequest;
  capability: PermissionCapability;
  compact?: boolean;
  onAllow: (permission: PendingPermissionRequest, updatedInput?: unknown) => void;
  onDeny: (permission: PendingPermissionRequest, message: string) => void;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bashCommand(permission: PendingPermissionRequest): string {
  if (!isObject(permission.toolInput)) return '';
  const command = permission.toolInput.command;
  return typeof command === 'string' ? command : '';
}

export default function PermissionActionCard({ permission, capability, compact = false, onAllow, onDeny }: Props) {
  const [isDenyOpen, setIsDenyOpen] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedCommand, setEditedCommand] = useState(() => bashCommand(permission));
  const canAct = capability.status === 'available';
  const canEditCommand = canAct && permission.editable === 'bashCommand';

  if (compact) {
    return (
      <section className="permission-card compact" aria-label="Pending permission">
        <span className="permission-kicker">Pending permission</span>
        <strong>{permission.toolName}</strong>
        <p>{permission.summary}</p>
        {canAct ? (
          <div className="permission-actions">
            <button type="button" onClick={() => onAllow(permission)}>Allow</button>
            <button type="button" onClick={() => setIsDenyOpen(true)}>Deny</button>
          </div>
        ) : (
          <p className="permission-unavailable">{capability.reason ?? 'Permission controls are unavailable.'}</p>
        )}
        {isDenyOpen && (
          <form
            className="permission-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              onDeny(permission, denyMessage);
            }}
          >
            <label>
              <span>Denial message</span>
              <input value={denyMessage} onChange={(event) => setDenyMessage(event.target.value)} />
            </label>
            <button type="submit">Send denial</button>
          </form>
        )}
      </section>
    );
  }

  return (
    <section className="permission-card" aria-label="Claude permission request">
      <div className="permission-card-heading">
        <span className="permission-kicker">Permission request</span>
        <h3>Claude needs your permission</h3>
      </div>
      <div className="permission-command-block">
        <span>{permission.toolName === 'Bash' ? 'Run:' : `${permission.toolName}:`}</span>
        <code>{permission.summary}</code>
      </div>
      {canAct ? (
        <div className="permission-actions">
          <button type="button" className="primary-action" onClick={() => onAllow(permission)}>Allow</button>
          <button type="button" onClick={() => setIsDenyOpen((open) => !open)}>Deny</button>
          {canEditCommand && <button type="button" onClick={() => setIsEditing((open) => !open)}>Edit command</button>}
        </div>
      ) : (
        <p className="permission-unavailable">{capability.reason ?? 'Permission controls are unavailable for this session.'}</p>
      )}
      {isDenyOpen && (
        <form
          className="permission-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onDeny(permission, denyMessage);
          }}
        >
          <label>
            <span>Denial message</span>
            <input value={denyMessage} onChange={(event) => setDenyMessage(event.target.value)} placeholder="Optional reason for Claude" />
          </label>
          <button type="submit">Send denial</button>
        </form>
      )}
      {isEditing && canEditCommand && (
        <form
          className="permission-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAllow(permission, { command: editedCommand });
          }}
        >
          <label>
            <span>Command to allow</span>
            <textarea value={editedCommand} onChange={(event) => setEditedCommand(event.target.value)} rows={3} />
          </label>
          <button type="submit">Allow edited command</button>
        </form>
      )}
      <details className="permission-details">
        <summary>Details</summary>
        <dl>
          <div><dt>Tool</dt><dd>{permission.toolName}</dd></div>
          {permission.cwd && <div><dt>CWD</dt><dd>{permission.cwd}</dd></div>}
          {permission.permissionMode && <div><dt>Permission mode</dt><dd>{permission.permissionMode}</dd></div>}
          <div><dt>Request</dt><dd>{permission.requestId}</dd></div>
        </dl>
        <pre>{JSON.stringify(permission.toolInput, null, 2)}</pre>
      </details>
    </section>
  );
}
