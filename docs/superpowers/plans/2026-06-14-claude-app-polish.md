# Claude App Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the existing web UI so it reads closer to the Claude app: warm paper surfaces, subtle sidebars, lower-border controls, more breathing room, rounded composer, consistent icon/pill buttons, and usable dark mode.

**Architecture:** This is a CSS-only visual refinement. Keep the existing React structure and class names, add stronger design-token coverage in `web/src/App.css`, and override component-specific surfaces in `web/src/App.css` and `web/src/ConversationBlockList.css` without changing behavior.

**Tech Stack:** React + Vite frontend, plain CSS, Vitest test suite, browser verification with the app preview.

---

## File Structure

- Modify `web/src/App.css`: global design tokens, dark mode tokens, button/control variants, shell/sidebar/header/composer/inspector/conversation block layout styles, responsive refinements.
- Modify `web/src/ConversationBlockList.css`: code/tool/diff/path frame polish and tokenized dark mode-compatible colors.
- Do not modify React component files unless browser verification proves an existing class hook is missing.
- Do not create new docs beyond this plan. After implementation, inspect `README.md` and `CLAUDE.md` for update needs; CSS-only visual polish likely requires no changes.

## Task 1: Establish tokenized Claude-like light and dark surfaces

**Files:**
- Modify: `web/src/App.css:1-32`

- [ ] **Step 1: Confirm baseline CSS-only visual scope**

Run:
```bash
git diff -- web/src/App.css web/src/ConversationBlockList.css
```
Expected: no relevant uncommitted CSS changes before starting, or only changes from this plan if resuming.

- [ ] **Step 2: Replace the initial `:root` token block with expanded light tokens**

In `web/src/App.css`, replace the first `:root { ... }` block at the top of the file with:

```css
:root {
  color: #2b261f;
  background: #f3eee6;
  font-family: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  font-synthesis: none;
  text-rendering: optimizeLegibility;

  --app-bg: #f3eee6;
  --app-bg-radial-1: rgb(255 250 241 / 0.92);
  --app-bg-radial-2: rgb(242 219 203 / 0.58);
  --app-bg-start: #f7f1e8;
  --app-bg-end: #efe7db;
  --rail-bg: rgb(237 228 215 / 0.7);
  --panel-bg: rgb(241 233 221 / 0.78);
  --panel-bg-solid: #f1e9dd;
  --panel-bg-2: #e8dfd1;
  --surface: #fffaf2;
  --surface-2: #fbf4ea;
  --surface-3: #f0e7d9;
  --surface-hover: #f4eadc;
  --surface-raised: rgb(255 250 242 / 0.88);
  --text: #2b261f;
  --text-soft: #514940;
  --muted: #7c7164;
  --muted-soft: #a09486;
  --border: #ded4c5;
  --border-subtle: rgb(111 94 75 / 0.12);
  --border-strong: #cfc0ad;
  --accent: #c36a47;
  --accent-strong: #9a4e34;
  --accent-soft: #f4e1d4;
  --focus-ring: 0 0 0 3px rgb(178 95 61 / 0.18);
  --success: #47745b;
  --success-soft: #e6f0e9;
  --warning: #886326;
  --warning-soft: #f8ead0;
  --danger: #9e4638;
  --danger-soft: #f7e4df;
  --info: #3f6690;
  --info-soft: #edf6ff;
  --shadow-soft: 0 1px 1px rgb(43 38 31 / 0.03), 0 14px 38px rgb(43 38 31 / 0.07);
  --shadow-popover: 0 24px 70px rgb(43 38 31 / 0.18);
}
```

- [ ] **Step 3: Add dark mode tokens immediately after the light tokens**

Add:

```css
@media (prefers-color-scheme: dark) {
  :root {
    color: #ede6dc;
    background: #181510;

    --app-bg: #181510;
    --app-bg-radial-1: rgb(117 82 57 / 0.2);
    --app-bg-radial-2: rgb(69 47 34 / 0.34);
    --app-bg-start: #211c16;
    --app-bg-end: #14110d;
    --rail-bg: rgb(30 25 19 / 0.82);
    --panel-bg: rgb(35 29 22 / 0.82);
    --panel-bg-solid: #231d16;
    --panel-bg-2: #2c241b;
    --surface: #2a231b;
    --surface-2: #241e17;
    --surface-3: #342b21;
    --surface-hover: #3a3025;
    --surface-raised: rgb(42 35 27 / 0.9);
    --text: #ede6dc;
    --text-soft: #d3c6b7;
    --muted: #aa9b8a;
    --muted-soft: #817466;
    --border: #463b2f;
    --border-subtle: rgb(237 230 220 / 0.1);
    --border-strong: #5a4c3d;
    --accent: #d48a66;
    --accent-strong: #f0aa84;
    --accent-soft: rgb(149 82 51 / 0.28);
    --focus-ring: 0 0 0 3px rgb(212 138 102 / 0.22);
    --success: #8cc49d;
    --success-soft: rgb(80 126 92 / 0.24);
    --warning: #ddb56d;
    --warning-soft: rgb(145 105 39 / 0.25);
    --danger: #e28b7a;
    --danger-soft: rgb(158 70 56 / 0.24);
    --info: #8fb8df;
    --info-soft: rgb(73 115 151 / 0.24);
    --shadow-soft: 0 1px 1px rgb(0 0 0 / 0.18), 0 18px 44px rgb(0 0 0 / 0.28);
    --shadow-popover: 0 28px 80px rgb(0 0 0 / 0.44);
  }
}
```

- [ ] **Step 4: Update body background to use tokens**

Replace the current `body` background declaration with:

```css
body {
  margin: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 8%, var(--app-bg-radial-1), transparent 34%),
    radial-gradient(circle at 82% 14%, var(--app-bg-radial-2), transparent 28%),
    linear-gradient(180deg, var(--app-bg-start) 0%, var(--app-bg-end) 100%);
}
```

- [ ] **Step 5: Run frontend tests for unchanged behavior**

Run:
```bash
npm --prefix web test
```
Expected: tests pass. CSS-only changes should not alter test behavior.

## Task 2: Soften global controls and named button variants

**Files:**
- Modify: `web/src/App.css:50-112`
- Modify existing selectors for `.primary-action`, `.send-button`, `button.danger`, `.action-menu summary`, icon-like buttons, tab/pill buttons.

- [ ] **Step 1: Replace global control typography and button base**

Replace the `button, input, select, textarea` block and base `button` block with:

```css
button,
input,
select,
textarea {
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  font: inherit;
}

button {
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--text-soft);
  background: transparent;
  padding: 8px 11px;
  font-weight: 620;
  line-height: 1.25;
  cursor: pointer;
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

button:hover {
  border-color: var(--border-subtle);
  color: var(--text);
  background: var(--surface-hover);
}
```

Keep the existing `button:active`, focus-visible, disabled, and input styles, but update input border radius to `10px` and focus border to `var(--accent)`.

- [ ] **Step 2: Update primary and send buttons**

Replace the `.primary-action, .send-button` and hover blocks with:

```css
.primary-action,
.send-button {
  border-color: #332b23;
  color: #fffaf2;
  background: linear-gradient(180deg, #3a3229, #27211b);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.08), 0 1px 2px rgb(43 38 31 / 0.1);
}

.primary-action:hover,
.send-button:hover {
  border-color: #463b31;
  color: #fffaf2;
  background: linear-gradient(180deg, #463b31, #302821);
}

@media (prefers-color-scheme: dark) {
  .primary-action,
  .send-button {
    border-color: #e8d1bd;
    color: #231d16;
    background: linear-gradient(180deg, #f2d8c2, #d7a77e);
  }

  .primary-action:hover,
  .send-button:hover {
    border-color: #f1dfcf;
    color: #181510;
    background: linear-gradient(180deg, #ffe4cf, #e3b087);
  }
}
```

- [ ] **Step 3: Update danger buttons**

Replace `button.danger` and `button.danger:hover` with:

```css
button.danger,
.composer-stop-button {
  border-color: transparent;
  color: var(--danger);
  background: var(--danger-soft);
}

button.danger:hover,
.composer-stop-button:hover {
  border-color: rgb(158 70 56 / 0.24);
  color: var(--danger);
  background: color-mix(in srgb, var(--danger-soft) 82%, var(--danger) 18%);
}
```

If browser verification shows `color-mix()` compatibility issues in the target browser, replace the hover background with `var(--danger-soft)` and rely on border/color only.

- [ ] **Step 4: Update menu and icon-like controls**

For `.action-menu summary`, `.composer-attach-button`, `.composer-history-button`, `.inspector-edge-toggle`, `.inspector-floating-toggle`, `.session-pin-button`, `.editable-session-title button`, and close/remove icon buttons, use transparent or `var(--surface-2)` backgrounds with transparent borders by default and visible hover backgrounds. Do not add new class names.

Concrete replacements:

```css
.action-menu summary {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--text-soft);
  background: transparent;
  font-weight: 620;
  list-style: none;
  cursor: pointer;
}

.composer-attach-button,
.composer-history-button {
  display: grid;
  place-items: center;
  min-width: 34px;
  height: 34px;
  border-color: transparent;
  border-radius: 999px;
  color: var(--muted);
  background: var(--surface-2);
}
```

- [ ] **Step 5: Run focused frontend tests**

Run:
```bash
npm --prefix web test -- App.test.tsx ConversationBlockList.test.tsx
```
Expected: both test files pass.

## Task 3: Refine shell, sidebar, header, and selected states

**Files:**
- Modify: `web/src/App.css:137-1713`

- [ ] **Step 1: Update shell and rail dimensions**

Use the already approved narrower rail values near the later override block as the canonical behavior. Ensure these selectors exist only once or the later selector wins clearly:

```css
.app-shell {
  display: grid;
  grid-template-columns: 58px minmax(260px, 312px) minmax(0, 1fr) var(--inspector-width, 360px);
  height: 100vh;
  min-height: 0;
  color: var(--text);
  background: transparent;
}

.primary-rail {
  position: relative;
  z-index: 20;
  display: grid;
  grid-template-rows: auto auto auto auto auto 1fr;
  gap: 6px;
  border-right: 1px solid var(--border-subtle);
  background: var(--rail-bg);
  padding: 11px 7px;
  backdrop-filter: blur(18px);
}
```

Update the sidebar-open/closed grid templates to use `58px` consistently.

- [ ] **Step 2: Update session sidebar to list-row treatment**

Ensure these selectors use tokenized subtle surfaces:

```css
.session-sidebar {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border-subtle);
  background: var(--panel-bg);
  backdrop-filter: blur(18px);
}

.session-row {
  position: relative;
  display: grid;
  min-width: 0;
  border: 1px solid transparent;
  border-radius: 12px;
}

.session-row:hover {
  border-color: transparent;
  background: rgb(255 250 242 / 0.5);
}

.session-row.active {
  border-color: var(--border-subtle);
  background: var(--surface-raised);
  box-shadow: none;
}
```

Add dark override for the hover if the literal light rgba reads too bright:

```css
@media (prefers-color-scheme: dark) {
  .session-row:hover {
    background: rgb(255 255 255 / 0.04);
  }
}
```

- [ ] **Step 3: Reduce header chrome**

Update `.conversation-header`:

```css
.conversation-header {
  display: grid;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  border-bottom: 1px solid var(--border-subtle);
  padding: 9px 18px;
  background: rgb(250 247 241 / 0.72);
  backdrop-filter: blur(14px);
}

@media (prefers-color-scheme: dark) {
  .conversation-header {
    background: rgb(24 21 16 / 0.72);
  }
}
```

- [ ] **Step 4: Tokenize hard-coded status colors touched by shell/sidebar**

Replace obvious hard-coded neutral backgrounds such as `#eee9e1`, `#f0e9df`, and `#fffdfa` in sidebar/session/status selectors with `var(--surface-3)`, `var(--surface-2)`, or `var(--surface)` so dark mode stays readable.

- [ ] **Step 5: Run app build to catch CSS syntax errors**

Run:
```bash
npm --prefix web run build
```
Expected: Vite build succeeds.

## Task 4: Refine conversation blocks, tool cards, code frames, and composer

**Files:**
- Modify: `web/src/App.css:2079-3332`
- Modify: `web/src/ConversationBlockList.css:1-208`

- [ ] **Step 1: Refine message and block surfaces in `App.css`**

Update block styling:

```css
.conversation-blocks {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.conversation-block {
  min-width: 0;
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  background: rgb(255 250 242 / 0.52);
  padding: 12px 14px;
}

.message-block {
  border-color: transparent;
  background: transparent;
  padding: 4px 2px;
}

.message-block.user {
  margin-left: auto;
  max-width: min(860px, 78%);
  border-color: var(--border-subtle);
  border-radius: 18px;
  background: var(--surface-raised);
  padding: 12px 14px;
  box-shadow: 0 1px 2px rgb(43 38 31 / 0.05);
}

.tool-block,
.task-block {
  border-color: var(--border-subtle);
  border-radius: 14px;
  background: rgb(255 250 242 / 0.42);
}

@media (prefers-color-scheme: dark) {
  .conversation-block,
  .tool-block,
  .task-block {
    background: rgb(255 255 255 / 0.035);
  }
}
```

- [ ] **Step 2: Refine composer**

Update `.composer`:

```css
.composer {
  display: grid;
  gap: 12px;
  width: min(calc(100% - 56px), 1120px);
  margin: 0 auto 20px;
  border: 1px solid var(--border-subtle);
  border-radius: 24px;
  background: var(--surface-raised);
  padding: 14px 16px 13px;
  box-shadow: var(--shadow-soft);
}

.composer:focus-within {
  border-color: rgb(195 106 71 / 0.36);
  box-shadow: var(--shadow-soft), var(--focus-ring);
}

.composer-input textarea {
  min-height: 34px;
  max-height: 220px;
  border: 0;
  background: transparent;
  padding: 3px 4px;
  box-shadow: none;
  resize: none;
}
```

Keep mobile override but change mobile radius to `20px` unless it causes layout crowding.

- [ ] **Step 3: Tokenize `ConversationBlockList.css` frames**

In `web/src/ConversationBlockList.css`, replace hard-coded light surfaces with tokens:

```css
.code-frame,
.tool-path-frame {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  background: var(--surface-2);
}

.code-frame-header,
.tool-path-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 34px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-3);
  padding: 5px 7px 5px 10px;
}

.conversation-block .tool-code-frame .tool-result-pre,
.message-text .message-code-frame .message-code,
.tool-result-pre.diff {
  background: var(--surface);
}
```

- [ ] **Step 4: Tokenize diff colors with dark mode overrides**

Keep semantic diff colors in light mode, then add dark overrides:

```css
@media (prefers-color-scheme: dark) {
  .diff-line.addition {
    background: rgb(80 126 92 / 0.2);
    color: #add9ba;
  }

  .diff-line.deletion {
    background: rgb(158 70 56 / 0.22);
    color: #efafa2;
  }

  .diff-line.hunk {
    background: rgb(130 103 181 / 0.2);
    color: #cdbcf2;
  }

  .diff-line.meta {
    background: var(--surface-3);
    color: var(--muted);
  }
}
```

- [ ] **Step 5: Run focused conversation tests**

Run:
```bash
npm --prefix web test -- ConversationBlockList.test.tsx conversationBlocks.test.ts eventDisplay.test.ts
```
Expected: all tests pass.

## Task 5: Refine inspector, activity cards, diagnostics, and responsive behavior

**Files:**
- Modify: `web/src/App.css:3364-4574`

- [ ] **Step 1: Soften inspector drawer**

Update:

```css
.inspector {
  position: relative;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  border-left: 1px solid var(--border-subtle);
  background: var(--panel-bg);
  backdrop-filter: blur(18px);
}

.inspector-header {
  display: grid;
  min-width: 0;
  border-bottom: 1px solid var(--border-subtle);
  padding: 15px 16px;
}

.inspector-tabs {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 3px;
  border-bottom: 1px solid var(--border-subtle);
  padding: 10px 10px 9px;
}

.inspector-tabs button[aria-selected='true'] {
  border-color: var(--border-subtle);
  color: var(--text);
  background: var(--surface-raised);
  box-shadow: none;
}
```

- [ ] **Step 2: Tokenize activity/diagnostic/task card hard-coded surfaces**

Replace hard-coded light neutral card backgrounds in `.activity-card`, `.activity-status`, `.activity-card-jump`, `.activity-empty`, `.diagnostic-block`, `.diagnostic-grid`, `.tasks-panel`, `.task-status-pill`, `.notice`, and `.success` with `var(--surface)`, `var(--surface-2)`, `var(--surface-3)`, `var(--border-subtle)`, and semantic token colors.

Keep status-specific color meaning, but use `var(--info-soft)`, `var(--warning-soft)`, `var(--danger-soft)`, and `var(--success-soft)` where possible.

- [ ] **Step 3: Update responsive rail width values**

In the `@media (max-width: 1100px)` block, update rail columns from `64px` to `58px` or `56px` consistently:

```css
.app-shell,
.app-shell.inspector-closed {
  grid-template-columns: 58px minmax(220px, 280px) minmax(0, 1fr);
  grid-template-rows: 1fr;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}
```

Ensure mobile `@media (max-width: 760px)` still uses one-column layout and composer remains readable.

- [ ] **Step 4: Run full frontend checks**

Run:
```bash
npm --prefix web test
npm --prefix web run build
```
Expected: tests and build pass.

## Task 6: Browser verification and documentation review

**Files:**
- Inspect: `README.md`
- Inspect: `CLAUDE.md`
- Modify docs only if the CSS-only visual polish changes documented behavior or setup.

- [ ] **Step 1: Start the app preview**

Use the project’s browser/dev-server workflow. If `.claude/launch.json` has a suitable frontend entry, use `preview_start`. If not, create a minimal launch config for the Vite frontend and start it.

Expected: app loads in browser preview without console errors.

- [ ] **Step 2: Verify light mode manually**

In the browser:
- Open the default/session page.
- Confirm the background is warm paper, not flat dashboard gray.
- Confirm sidebar rows have subtle hover and selected state.
- Confirm buttons are lower-border by default, with clear primary/send/danger hierarchy.
- Confirm composer is rounded, spacious, and readable.
- Confirm tool/code cards look like shallow disclosure surfaces, not heavy panels.

- [ ] **Step 3: Verify dark mode manually**

Use preview viewport color-scheme emulation or browser devtools to emulate dark mode.

Confirm:
- No light hard-coded panels remain in the primary shell, sidebar, conversation, composer, or inspector.
- Text contrast is readable.
- Semantic status colors remain distinguishable.
- Code and diff frames remain readable.

- [ ] **Step 4: Verify mobile manually**

Resize preview to mobile.

Confirm:
- Rail/header/sidebar remain usable.
- Composer does not crowd or clip controls.
- Conversation blocks and user messages stay readable.
- Inspector collapsed state does not cover core chat content unexpectedly.

- [ ] **Step 5: Review documentation needs**

Read `README.md` and `CLAUDE.md` sections related to UI/design/setup.

Expected: no documentation updates required for CSS-only visual polish unless a documented screenshot/style description becomes wrong. Mention the result in the final summary.

- [ ] **Step 6: Final diff review**

Run:
```bash
git diff -- web/src/App.css web/src/ConversationBlockList.css README.md CLAUDE.md
```
Expected: diff only contains the approved visual polish and any necessary docs updates.

## Self-Review

- Spec coverage: Covers warm paper background, subtle sidebar, low-border controls, larger whitespace, rounded composer, minimal icon buttons, soft focus rings, selected state, dark mode, mobile, browser verification, and docs review.
- Placeholder scan: No TBD/TODO placeholders remain. The only conditional instruction is a concrete browser-compat fallback for `color-mix()`.
- Type consistency: CSS variable names are defined before use; all tasks use existing selectors and files.
