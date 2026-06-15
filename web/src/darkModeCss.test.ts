import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'App.css'), 'utf8');
const finalDarkOverrides = css.slice(css.lastIndexOf('@media (prefers-color-scheme: dark)'));

describe('dark mode CSS', () => {
  it('overrides light-only alert and empty-state surfaces with dark tokens', () => {
    expect(finalDarkOverrides).toContain('.session-empty-error');
    expect(finalDarkOverrides).toMatch(/\.session-empty-error[\s\S]*background: var\(--danger-soft\)/);
    expect(finalDarkOverrides).toMatch(/\.api-error[\s\S]*color: var\(--text-soft\)[\s\S]*background: var\(--danger-soft\)/);
    expect(finalDarkOverrides).toMatch(/\.session-empty-error \.state-kicker[\s\S]*color: var\(--danger\)/);
    expect(finalDarkOverrides).toMatch(/\.deleted-note[\s\S]*background: var\(--warning-soft\)/);
    expect(finalDarkOverrides).toMatch(/\.message-text code[\s\S]*background: var\(--surface-3\)/);
    expect(finalDarkOverrides).toMatch(/\.primary-rail button,[\s\S]*\.session-list-toolbar h2[\s\S]*color: var\(--muted\)/);
    expect(finalDarkOverrides).toMatch(/\.primary-action,[\s\S]*\.send-button[\s\S]*color: #fffaf2[\s\S]*background: linear-gradient\(180deg, #5a3f31, #3f2d23\)/);
    expect(finalDarkOverrides).toMatch(/\.primary-action:hover,[\s\S]*\.send-button:hover[\s\S]*color: #fffaf2[\s\S]*background: linear-gradient\(180deg, #6a4b3b, #4a3429\)/);
  });
});
