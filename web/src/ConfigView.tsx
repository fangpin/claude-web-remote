import { FormEvent, useEffect, useState } from 'react';
import { getConfig, updateConfig } from './api';
import type { ConfigValues, ManagedConfig } from './types';

type FormState = {
  bind: string;
  dataDir: string;
  launcher: string;
  webDir: string;
  defaultPermissionMode: string;
  worktreesDir: string;
  worktreeBranchPrefix: string;
  worktreeBaseRef: 'fresh' | 'head';
};

function formFromConfig(config: ConfigValues): FormState {
  return {
    bind: config.bind,
    dataDir: config.dataDir,
    launcher: config.launcher.join('\n'),
    webDir: config.webDir ?? '',
    defaultPermissionMode: config.defaultPermissionMode,
    worktreesDir: config.worktreesDir ?? '',
    worktreeBranchPrefix: config.worktreeBranchPrefix,
    worktreeBaseRef: config.worktreeBaseRef
  };
}

function configFromForm(form: FormState): ConfigValues {
  return {
    bind: form.bind,
    dataDir: form.dataDir,
    launcher: form.launcher
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean),
    webDir: form.webDir.trim() || null,
    defaultPermissionMode: form.defaultPermissionMode,
    worktreesDir: form.worktreesDir.trim() || null,
    worktreeBranchPrefix: form.worktreeBranchPrefix,
    worktreeBaseRef: form.worktreeBaseRef
  };
}

export default function ConfigView() {
  const [managedConfig, setManagedConfig] = useState<ManagedConfig | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then((loaded) => {
        setManagedConfig(loaded);
        setForm(formFromConfig(loaded.file));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => current ? { ...current, [field]: value } : current);
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!form) return;

    setError(null);
    setSuccess(null);

    const payload = configFromForm(form);
    if (payload.launcher.length === 0) {
      setError('Launcher must contain at least one value.');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateConfig(payload);
      setManagedConfig(updated);
      setForm(formFromConfig(updated.file));
      setSuccess('Config saved. Restart the daemon for changes to take effect.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p>Loading config...</p>;
  }

  return (
    <section className="config-panel">
      <div className="config-header">
        <h2>Daemon config</h2>
        {managedConfig && <p>{managedConfig.path}</p>}
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <p className="notice">Saved changes require a manual daemon restart before they take effect.</p>
      {form && (
        <form className="config-form" onSubmit={onSave}>
          <label>
            Bind address
            <input value={form.bind} onChange={(event) => updateField('bind', event.target.value)} />
          </label>
          <label>
            Data directory
            <input value={form.dataDir} onChange={(event) => updateField('dataDir', event.target.value)} />
          </label>
          <label>
            Launcher argv
            <textarea value={form.launcher} onChange={(event) => updateField('launcher', event.target.value)} />
          </label>
          <label>
            Web directory
            <input value={form.webDir} onChange={(event) => updateField('webDir', event.target.value)} />
          </label>
          <label>
            Default permission mode
            <select value={form.defaultPermissionMode} onChange={(event) => updateField('defaultPermissionMode', event.target.value)}>
              <option value="acceptEdits">acceptEdits</option>
              <option value="auto">auto</option>
              <option value="default">default</option>
            </select>
          </label>
          <label>
            Worktrees directory
            <input value={form.worktreesDir} onChange={(event) => updateField('worktreesDir', event.target.value)} />
          </label>
          <label>
            Worktree branch prefix
            <input value={form.worktreeBranchPrefix} onChange={(event) => updateField('worktreeBranchPrefix', event.target.value)} />
          </label>
          <label>
            Worktree base ref
            <select value={form.worktreeBaseRef} onChange={(event) => updateField('worktreeBaseRef', event.target.value as FormState['worktreeBaseRef'])}>
              <option value="fresh">fresh</option>
              <option value="head">head</option>
            </select>
          </label>
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save config'}</button>
        </form>
      )}
    </section>
  );
}
