import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  createSession,
  deleteSession,
  eventsUrl,
  listSessions,
  permanentlyDeleteSession,
  restartSession,
  restoreSession,
  resumeSession,
  sendInput,
  stopSession
} from './api';
import EventCard from './EventCard';
import type { SessionInfo, UiEvent } from './types';
import './App.css';

type SessionListMode = 'active' | 'deleted';

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [listMode, setListMode] = useState<SessionListMode>('active');
  const [events, setEvents] = useState<Record<string, UiEvent[]>>({});
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [permissionMode, setPermissionMode] = useState('acceptEdits');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId]
  );

  useEffect(() => {
    listSessions({ deletedOnly: listMode === 'deleted' })
      .then((loaded) => {
        setSessions(loaded);
        setActiveId(loaded[0]?.id ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [listMode]);

  useEffect(() => {
    if (!activeId || listMode === 'deleted') return;
    const afterId = events[activeId]?.at(-1)?.id ?? 0;
    const socket = new WebSocket(eventsUrl(activeId, afterId));
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as UiEvent;
      setEvents((current) => ({
        ...current,
        [activeId]: [...(current[activeId] ?? []), event]
      }));
    };
    socket.onclose = () => undefined;
    return () => socket.close();
  }, [activeId, listMode]);

  async function onCreateSession(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const created = await createSession({
        cwd,
        name: name.trim() || undefined,
        permissionMode
      });
      setSessions((current) => [created, ...current]);
      setActiveId(created.id);
      setCwd('');
      setName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!activeId || !message.trim()) return;
    const text = message;
    setMessage('');
    await sendInput(activeId, text);
  }

  async function onStop() {
    if (!activeId) return;
    setError(null);
    try {
      await stopSession(activeId);
      setSessions((current) => current.map((session) => session.id === activeId ? { ...session, status: 'stopped' } : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestart() {
    if (!activeId) return;
    setError(null);
    try {
      const restarted = await restartSession(activeId);
      setSessions((current) => current.map((session) => session.id === activeId ? restarted : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onResume() {
    if (!activeId) return;
    setError(null);
    try {
      const resumed = await resumeSession(activeId);
      setSessions((current) => current.map((session) => session.id === activeId ? resumed : session));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete() {
    if (!activeId) return;
    if (!confirm('Delete this session? It can be restored from Deleted sessions.')) return;
    setError(null);
    try {
      await deleteSession(activeId);
      setSessions((current) => {
        const remaining = current.filter((session) => session.id !== activeId);
        setActiveId(remaining[0]?.id ?? null);
        return remaining;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onRestore() {
    if (!activeId) return;
    setError(null);
    try {
      await restoreSession(activeId);
      setSessions((current) => {
        const remaining = current.filter((session) => session.id !== activeId);
        setActiveId(remaining[0]?.id ?? null);
        return remaining;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onPermanentDelete() {
    if (!activeId) return;
    if (!confirm('Permanently delete this session and its local event logs? This cannot be undone.')) return;
    setError(null);
    try {
      await permanentlyDeleteSession(activeId);
      setSessions((current) => {
        const remaining = current.filter((session) => session.id !== activeId);
        setActiveId(remaining[0]?.id ?? null);
        return remaining;
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function renderActions() {
    if (!activeSession) return null;
    if (listMode === 'deleted') {
      return (
        <div className="actions">
          <button onClick={onRestore}>Restore</button>
          <button className="danger" onClick={onPermanentDelete}>Permanently delete</button>
        </div>
      );
    }

    if (activeSession.status === 'running') {
      return (
        <div className="actions">
          <button onClick={onStop}>Stop</button>
          <button onClick={onRestart}>Restart</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      );
    }

    if (activeSession.status === 'starting') {
      return (
        <div className="actions">
          <button onClick={onStop}>Stop</button>
          <button className="danger" onClick={onDelete}>Delete</button>
        </div>
      );
    }

    return (
      <div className="actions">
        <button onClick={onResume}>Resume</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>Claude Remote Web</h1>
        <form className="new-session" onSubmit={onCreateSession}>
          <label>
            Working directory
            <input value={cwd} onChange={(event) => setCwd(event.target.value)} placeholder="/data00/home/user/repos/project" required />
          </label>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Optional" />
          </label>
          <label>
            Permission mode
            <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
              <option value="acceptEdits">acceptEdits</option>
              <option value="auto">auto</option>
              <option value="default">default</option>
            </select>
          </label>
          <button type="submit">Create session</button>
        </form>
        <div className="session-modes" role="group" aria-label="Session list mode">
          <button
            type="button"
            className={listMode === 'active' ? 'selected' : undefined}
            onClick={() => setListMode('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={listMode === 'deleted' ? 'selected' : undefined}
            onClick={() => setListMode('deleted')}
          >
            Deleted
          </button>
        </div>
        <section className="sessions">
          {sessions.length === 0 && <p>{listMode === 'deleted' ? 'No deleted sessions.' : 'No sessions yet.'}</p>}
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === activeId ? 'session active' : 'session'}
              onClick={() => setActiveId(session.id)}
            >
              <strong>{session.name || session.cwd}</strong>
              <span>{session.cwd}</span>
              <em>{session.status}</em>
            </button>
          ))}
        </section>
      </aside>
      <section className="conversation">
        {error && <p role="alert" className="error">{error}</p>}
        {activeSession ? (
          <>
            <header className="conversation-header">
              <div>
                <h2>{activeSession.name || activeSession.cwd}</h2>
                <p>{activeSession.cwd}</p>
              </div>
              {renderActions()}
            </header>
            <div className="events">
              {(events[activeSession.id] ?? []).map((event, index) => (
                <EventCard key={`${event.id}-${index}`} event={event} />
              ))}
            </div>
            {listMode === 'active' && (
              <form className="composer" onSubmit={onSend}>
                <label>
                  Message
                  <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={3} />
                </label>
                <button type="submit">Send</button>
              </form>
            )}
          </>
        ) : (
          <div className="empty-state">Create or select a session.</div>
        )}
      </section>
    </main>
  );
}
