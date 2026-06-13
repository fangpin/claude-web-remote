import { FormEvent, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getConfig, updateConfig } from './api';
import type { ConfigValues, ManagedConfig } from './types';
import './ConfigView.css';

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

type ConfigField = keyof ConfigValues;

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

function comparableValue(value: ConfigValues[ConfigField]) {
  return Array.isArray(value) ? value : value ?? null;
}

function sameConfigValue(left: ConfigValues[ConfigField], right: ConfigValues[ConfigField]) {
  return JSON.stringify(comparableValue(left)) === JSON.stringify(comparableValue(right));
}

function optionalText(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'Not configured';
}

function formatConfigValue(config: ConfigValues, field: ConfigField): string {
  switch (field) {
    case 'launcher':
      return config.launcher.length > 0 ? config.launcher.join(' ') : 'Not configured';
    case 'webDir':
      return optionalText(config.webDir);
    case 'worktreesDir':
      return optionalText(config.worktreesDir);
    default:
      return String(config[field]);
  }
}

function fieldStatus(managedConfig: ManagedConfig, field: ConfigField) {
  const differs = !sameConfigValue(managedConfig.file[field], managedConfig.current[field]);
  if (managedConfig.restartRequired && differs) {
    return { label: 'Restart required', tone: 'warning' };
  }
  if (differs) {
    return { label: 'File differs', tone: 'notice' };
  }
  return { label: 'Current', tone: 'success' };
}

function StatusCard({
  label,
  value,
  detail,
  tone = 'neutral'
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  return (
    <div className={`settings-status-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function SettingsGroup({
  title,
  summary,
  children
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  const headingId = `settings-group-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section className="settings-group" aria-labelledby={headingId}>
      <div className="settings-group-heading">
        <h3 id={headingId}>{title}</h3>
        <p>{summary}</p>
      </div>
      <div className="settings-fields">
        {children}
      </div>
    </section>
  );
}

function SettingsField({
  id,
  field,
  label,
  detail,
  managedConfig,
  children
}: {
  id: string;
  field: ConfigField;
  label: string;
  detail?: string;
  managedConfig: ManagedConfig;
  children: ReactNode;
}) {
  const status = fieldStatus(managedConfig, field);

  return (
    <div className="settings-field">
      <div className="settings-field-heading">
        <div>
          <label className="settings-label" htmlFor={id}>{label}</label>
          {detail && <p>{detail}</p>}
        </div>
        <span className={`settings-chip tone-${status.tone}`}>{status.label}</span>
      </div>
      {children}
      <dl className="settings-value-pair">
        <div>
          <dt>File</dt>
          <dd>{formatConfigValue(managedConfig.file, field)}</dd>
        </div>
        <div>
          <dt>Current</dt>
          <dd>{formatConfigValue(managedConfig.current, field)}</dd>
        </div>
      </dl>
    </div>
  );
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
      setSuccess(updated.restartRequired
        ? 'Config saved. Restart the daemon for changes to take effect.'
        : 'Config saved. Current daemon values already match the file.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="settings-loading">Loading settings...</p>;
  }

  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <header className="settings-header">
        <div>
          <span className="settings-eyebrow">Daemon config</span>
          <h2 id="settings-title">Settings</h2>
          {managedConfig && <p>{managedConfig.path}</p>}
        </div>
        {managedConfig && (
          <div className="settings-status-grid" aria-label="Config status">
            <StatusCard
              label="file"
              value={managedConfig.exists ? 'Present' : 'Missing'}
              detail={managedConfig.exists ? 'Loaded from disk' : 'Will be created on save'}
              tone={managedConfig.exists ? 'success' : 'neutral'}
            />
            <StatusCard
              label="current"
              value="Runtime"
              detail="Values active in this daemon"
              tone="neutral"
            />
            <StatusCard
              label="restartRequired"
              value={managedConfig.restartRequired ? 'true' : 'false'}
              detail={managedConfig.restartRequired ? 'File changes are not active yet' : 'File and runtime match'}
              tone={managedConfig.restartRequired ? 'warning' : 'success'}
            />
          </div>
        )}
      </header>
      {error && <p role="alert" className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <p className="settings-notice">Saving writes file values. Current values change after the daemon restarts.</p>
      {form && managedConfig && (
        <form className="settings-form" onSubmit={onSave}>
          <SettingsGroup title="Server" summary="Network and storage paths.">
            <SettingsField
              id="settings-bind"
              field="bind"
              label="Bind address"
              detail="The daemon should stay bound to localhost unless you intentionally tunnel it."
              managedConfig={managedConfig}
            >
              <input id="settings-bind" value={form.bind} onChange={(event) => updateField('bind', event.target.value)} />
            </SettingsField>
            <SettingsField
              id="settings-data-dir"
              field="dataDir"
              label="Data directory"
              managedConfig={managedConfig}
            >
              <input id="settings-data-dir" value={form.dataDir} onChange={(event) => updateField('dataDir', event.target.value)} />
            </SettingsField>
          </SettingsGroup>

          <SettingsGroup title="Launcher" summary="Command argv used before native Claude arguments.">
            <SettingsField
              id="settings-launcher"
              field="launcher"
              label="Launcher argv"
              detail="Put one argv value on each line."
              managedConfig={managedConfig}
            >
              <textarea
                id="settings-launcher"
                rows={4}
                value={form.launcher}
                onChange={(event) => updateField('launcher', event.target.value)}
              />
            </SettingsField>
          </SettingsGroup>

          <SettingsGroup title="Web assets" summary="Optional static asset directory.">
            <SettingsField
              id="settings-web-dir"
              field="webDir"
              label="Web directory"
              managedConfig={managedConfig}
            >
              <input id="settings-web-dir" value={form.webDir} onChange={(event) => updateField('webDir', event.target.value)} />
            </SettingsField>
          </SettingsGroup>

          <SettingsGroup title="Defaults" summary="Session defaults for new launches.">
            <SettingsField
              id="settings-permission-mode"
              field="defaultPermissionMode"
              label="Default permission mode"
              managedConfig={managedConfig}
            >
              <select id="settings-permission-mode" value={form.defaultPermissionMode} onChange={(event) => updateField('defaultPermissionMode', event.target.value)}>
                <option value="bypassPermissions">bypassPermissions</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="auto">auto</option>
                <option value="default">default</option>
              </select>
            </SettingsField>
          </SettingsGroup>

          <SettingsGroup title="Worktrees" summary="Git worktree defaults for isolated sessions.">
            <SettingsField
              id="settings-worktrees-dir"
              field="worktreesDir"
              label="Worktrees directory"
              managedConfig={managedConfig}
            >
              <input id="settings-worktrees-dir" value={form.worktreesDir} onChange={(event) => updateField('worktreesDir', event.target.value)} />
            </SettingsField>
            <SettingsField
              id="settings-worktree-prefix"
              field="worktreeBranchPrefix"
              label="Worktree branch prefix"
              managedConfig={managedConfig}
            >
              <input id="settings-worktree-prefix" value={form.worktreeBranchPrefix} onChange={(event) => updateField('worktreeBranchPrefix', event.target.value)} />
            </SettingsField>
            <SettingsField
              id="settings-worktree-base-ref"
              field="worktreeBaseRef"
              label="Worktree base ref"
              managedConfig={managedConfig}
            >
              <select id="settings-worktree-base-ref" value={form.worktreeBaseRef} onChange={(event) => updateField('worktreeBaseRef', event.target.value as FormState['worktreeBaseRef'])}>
                <option value="fresh">fresh</option>
                <option value="head">head</option>
              </select>
            </SettingsField>
          </SettingsGroup>

          <div className="settings-actions">
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save config'}</button>
          </div>
        </form>
      )}
    </section>
  );
}
