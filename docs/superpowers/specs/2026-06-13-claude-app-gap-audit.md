# Claude App Gap Audit And Regression Checklist

## Goal

Audit Claude Remote Web from a product and QA perspective against the native Claude App / Claude Code App experience. This checklist is meant to be executable: each gap has priority, current status, user impact, owner workstream, and a concrete regression target.

## Current Status Refresh

Master now includes several follow-up branches after the first gap audit. The product assessment should treat these as meaningful improvements, while still holding the release on backend verification.

Improved since the prior audit:

- Settings: the config surface is now grouped and more settings-like, with stronger handling for launcher, bind, web dir, data dir, permission mode, and worktree fields.
- Visual QA: Playwright visual smoke now covers wide desktop, desktop, and narrow viewports with layout assertions for shell, config, transcript, tasks, empty states, autocomplete, and composer obstruction.
- Task center: task panels now have clearer activity states, global/session scope, compact inspector behavior, and more robust long-title/summary handling.
- Transcript semantics: tool output presentation now has explicit semantics for visible, hidden, raw, and error-like payloads instead of relying only on generic stream rendering.
- Shell extraction: the frontend shell has been split into dedicated AppShell, Composer, ConversationWorkspace, InspectorPanel, and SessionSidebar components, reducing layout coupling and future parity risk.

Current release blocker:

- P0: `cargo test --manifest-path Cargo.toml` is red with backend failures. Frontend unit tests, frontend build, frontend visual smoke, and `cargo fmt --manifest-path Cargo.toml -- --check` are known green, but the backend red light blocks release confidence.

## Priority Guide

- P0: Blocks release or a daily Claude-like workflow, or risks hidden input, lost context, blank panels, unusable responsive layout, or a failing required verification gate.
- P1: Noticeable parity or usability gap with a workaround.
- P2: Polish, discoverability, or future native-app parity.
- Improved: Previously material gap that has moved out of immediate P0/P1 risk but still needs regression coverage.

## Gap Matrix

| Area | Current status | Priority | User impact | Owner workstream | Executable acceptance |
| --- | --- | --- | --- | --- | --- |
| Backend verification | Full `cargo test` is currently red with backend failures. | P0 | Release candidates cannot be trusted even if the frontend is green. | Backend session/task/API | `cargo fmt --manifest-path Cargo.toml -- --check` and `cargo test --manifest-path Cargo.toml` both pass before release. |
| Settings | Improved: config now reads as a settings surface instead of a daemon-only form, but runtime health diagnostics are still shallow. | P1 | Misconfiguration is easier to inspect, but launcher/CLI readiness can still require terminal debugging. | Settings + Runtime diagnostics | Settings groups fields by purpose, validates inputs, and exposes restart-needed/resolved-config/health state. |
| Visual QA / responsive | Improved: layout smoke exists across key viewports with assertions against blank regions, overflow, collisions, and composer obstruction. | Improved | Major responsive regressions are now much more likely to be caught before release. | Responsive shell + QA | Keep `npm --prefix web run test:visual` green and extend fixtures when new shell regions or empty states are added. |
| Task center | Improved: session/global task panels and activity states are clearer, but native-grade filtering, cancellation, logs, and durable follow-up workflows remain incomplete. | P1 | Long-running work is visible and navigable, but not yet a fully confident operations center. | Tasks + Agent orchestration | Session/all tasks remain reachable; long titles and summaries wrap or clamp; selecting a task returns to the owning session/event when available; future controls cover cancel/log/follow-up. |
| Transcript semantics | Improved: recognized tool output has clearer presentation policy and raw payload access, but the transcript is not yet a complete Claude App model. | P1 | Most output is readable; uncommon stream-json shapes can still degrade to weak hierarchy or raw/debug blocks. | Message rendering | Text, lists, headings, long tokens, paths, code, tool summaries, hidden payloads, errors, and raw details stay inside the conversation column. |
| Shell architecture | Improved: shell regions are extracted and easier to reason about, but product IA still trails native recent/project/task/settings models. | P1 | Users can see chat/sidebar/inspector roles, yet global work versus session work still requires some inference. | Product IA + Frontend shell | Primary navigation exposes stable destinations; chat, session list, task inspector, and config are visually distinct at desktop and mobile widths. |
| Session navigation | Sessions are searchable and visually structured, but not grouped by recency, project, pinned state, or resume intent. | P1 | Returning to the right work requires scanning names, paths, and branches. | Session navigation | Long names, cwd values, and worktree branches wrap safely; selected/running/waiting/stopped/archived states remain distinguishable; next iteration adds recency/project/pinned grouping. |
| Composer | Core send, multiline, IME, stop, context hints, and slash autocomplete exist, but richer Claude App behaviors such as prompt history, attachments, and deeper command palette are absent. | P1 | Basic work is possible; advanced Claude Code workflows feel thinner. | Composer + Commands | Empty send is disabled; Enter/Shift+Enter/IME behavior works; autocomplete stays inside composer and viewport; composer never hides typed text; next iteration adds history/commands. |
| Composer context | Long cwd/worktree/permission context can consume limited composer space. | P1 | Users may lose where input will run, especially on narrow screens. | Responsive UX | Context chips and controls fit at 390px without horizontal page overflow. |
| Message rendering | No syntax highlighting, artifact preview, diff preview, or file-aware rendering comparable to richer Claude surfaces. | P2 | Reviewing edits/output is less efficient. | Output rendering + File UX | Code and preformatted output remain scrollable/wrapped without viewport overflow while richer previews are added later. |
| Tool permission surface | Tool activity is summarized, but there is no first-class live timeline, permission decision surface, or expanded tool drawer. | P1 | Users can follow activity but may not know why Claude is waiting or what needs action. | Tooling UX + Permission UX | Running/completed/failed/collapsed/hidden tool states have clear labels and raw payload access; permission waits become explicit actionable UI. |
| Empty states | Conversation starter, empty search, no-task, archived, and config states have stronger visual coverage, but loading/API-error language is not yet a unified native-like system. | P1 | First-run and recovery states are safer, but error recovery can still feel uneven. | Empty states + Product language | Empty conversation, no session, no tasks, no results, archived, loading, and API error states have automated or manual acceptance coverage. |
| Native integration | Browser UI lacks native desktop affordances such as notifications, menu/dock actions, file drag/drop, global shortcut, and OS window state. | P2 | Acceptable for remote web MVP, but caps Claude App parity. | Native wrapper / Distribution | Keep web MVP explicit and document native affordances as out of scope until a wrapper exists; next parity phase defines native notifications. |

## Claude App Parity Roadmap

Next phase should prioritize the parity gaps that still shape daily work:

1. Session navigation: add native-like recent/project grouping, pinned or favorite sessions, archived filtering, and resume intent cues.
2. Composer history and commands: add prompt history recall, richer command palette behavior, and a clearer command model beyond current slash autocomplete.
3. Tool permission surface: make permission waits, risky operations, tool timelines, and expanded payload review first-class instead of transcript-only.
4. Native notifications: define the web/wrapper path for background task completion, permission-needed, and session-failed notifications.

## Regression Checklist

### Information Architecture And Navigation

- Sessions, Config/Settings, Tasks, and Archived destinations are reachable from primary navigation.
- Session sidebar can create, search, select, and distinguish active/running/waiting/stopped sessions.
- Long session names, cwd values, and worktree branches do not create horizontal page overflow.
- Config opens without inheriting an unusable chat composer/inspector state.
- Archived sessions clearly communicate read-only state and restore path.

### Composer

- Composer is visible for active sendable sessions.
- Empty composer cannot send; pending send cannot duplicate.
- Enter sends, Shift+Enter inserts newline, and IME Enter does not send early.
- Slash autocomplete appears above the textarea, stays within composer width, and stays in the viewport.
- Multiline drafts resize to a cap and then scroll internally.
- Composer does not cover the last visible conversation block.

### Message, Tool, And Task Rendering

- Assistant, user, and system messages are visually distinct.
- Markdown headings, lists, inline code, fenced code, long tokens, and long file paths stay within the conversation column.
- Read/Grep/Glob results remain compact; Bash/Edit/Agent/task activity shows readable status.
- Failed tool/task output is visible enough to diagnose without opening raw JSON first.
- Hidden or policy-suppressed payloads still expose raw details when needed.
- Raw event details remain accessible and collapsed by default.
- Task cards show status, source, title, summary, and session context without widening the inspector.

### Responsive And Empty States

- At 1440px, rail, session sidebar, conversation, inspector, event stream, and composer have non-empty boxes.
- At 1024px, inspector behavior does not shrink or overlap the conversation unexpectedly.
- At 390px, rail/sidebar/workspace/inspector/autocomplete/composer fit without horizontal page scroll.
- Conversation and inspector can scroll independently when content is tall.
- Empty conversation starter remains visible and does not collide with composer.
- Empty search results, no-task inspector panels, archived sessions, and config workspace fit at all visual-smoke viewports.

## Release Acceptance Checklist

Release candidates should not ship until each gate is explicitly recorded:

- Backend: `cargo fmt --manifest-path Cargo.toml -- --check` is green and `cargo test --manifest-path Cargo.toml` is green. Current known status: fmt green, cargo test red with backend failures.
- Frontend unit: `npm --prefix web test` is green. Current known status: green.
- Frontend build: `npm --prefix web run build` is green. Current known status: green.
- Visual: `npm --prefix web run test:visual` is green across wide desktop, desktop, and narrow viewports. Current known status: green.
- Manual smoke: start the daemon from source, open the UI through the loopback/SSH workflow, create a session, send a prompt, observe transcript/tool/task rendering, open settings, search/select/archive/restore a session, and confirm narrow viewport usability. Current known status: not re-run for this docs refresh.

## Automated Coverage Added

`web/e2e/visual.spec.ts` uses Playwright layout assertions instead of screenshot snapshots. The mocked fixture covers long paths, long branch names, stopped and archived sessions, config workspace fields, long task titles/summaries, long message tokens, tool/task blocks, failed Bash output, autocomplete, a long multiline composer draft, an empty conversation starter, empty search results, and a no-task session across wide desktop, desktop, and narrow viewports.

The smoke guards against blank regions, viewport overflow, element overflow, sidebar/workspace/inspector collisions, config inheriting chat-only regions, failed tool output being hidden, long composer drafts losing their internal scroll cap, composer obstruction of the event stream, and autocomplete covering typed text.

Not covered yet: real Claude CLI stream permutations beyond local fixtures, no-session/API-loading/API-error states, native desktop affordances, and pixel-perfect comparison to Claude App.
