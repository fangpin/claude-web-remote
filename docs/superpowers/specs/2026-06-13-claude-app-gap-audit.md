# Claude App Gap Audit And Regression Checklist

## Goal

Audit Claude Remote Web from a product and QA perspective against the native Claude App / Claude Code App experience. This checklist is meant to be executable: each gap has priority, user impact, owner workstream, and a concrete regression target.

## Priority Guide

- P0: Blocks a daily Claude-like workflow or risks hidden input, lost context, blank panels, or unusable responsive layout.
- P1: Noticeable parity or usability gap with a workaround.
- P2: Polish, discoverability, or future native-app parity.

## Gap Matrix

| Area | Gap | Priority | User impact | Owner workstream | Executable acceptance |
| --- | --- | --- | --- | --- | --- |
| Information architecture | The shell has chat/sidebar/inspector regions, but still lacks a native-style model for recent chats, projects/repos, tasks, and settings. | P1 | Users must infer where global work differs from session work. | Product IA + Frontend shell | Primary navigation exposes stable destinations; chat, session list, task inspector, and config are visually distinct at desktop and mobile widths. |
| Session navigation | Sessions are searchable but not grouped by recency, project, pinned state, or resume intent. | P1 | Returning to the right work requires scanning names, paths, and branches. | Session navigation | Long names, cwd values, and worktree branches wrap safely; selected/running/waiting/stopped/archived states remain distinguishable. |
| Composer | Core send, multiline, IME, stop, context hints, and slash autocomplete exist, but richer Claude App behaviors such as prompt history, attachments, and deeper command palette are absent. | P1 | Basic work is possible, advanced Claude Code workflows feel thinner. | Composer + Commands | Empty send is disabled; Enter/Shift+Enter/IME behavior works; autocomplete stays inside composer and viewport; composer never hides typed text. |
| Composer | Long cwd/worktree/permission context can consume limited composer space. | P1 | Users may lose where input will run, especially on narrow screens. | Responsive UX | Context chips and controls fit at 390px without horizontal page overflow. |
| Message rendering | Markdown-ish text, code, tool blocks, task blocks, and raw details are readable, but not a complete Claude transcript model. | P1 | Some stream-json shapes may degrade to raw/debug blocks or weak hierarchy. | Message rendering | Text, lists, headings, long tokens, paths, code, tool summaries, errors, and raw details stay inside the conversation column. |
| Message rendering | No syntax highlighting, artifact preview, diff preview, or file-aware rendering comparable to richer Claude surfaces. | P2 | Reviewing edits/output is less efficient. | Output rendering + File UX | Code and preformatted output remain scrollable/wrapped without viewport overflow while richer previews are added later. |
| Tool display | Tool activity is summarized, but there is no first-class live timeline, permission decision surface, or expanded tool drawer. | P1 | Users can follow activity but may not know why Claude is waiting or what needs action. | Tooling UX + Permission UX | Running/completed/failed/collapsed/hidden tool states have clear labels and raw payload access. |
| Tasks / agent | Background Bash and Agent tasks appear in transcript/inspector, but there is no native task center with filtering, ownership, cancellation, logs, and durable follow-up state. | P1 | Long-running work is visible but not yet a confident operational workflow. | Tasks + Agent orchestration | Session/all tasks remain reachable; long titles and summaries wrap or clamp; selecting a task returns to the owning session/event when available. |
| Settings | Config is daemon-centric and lacks health diagnostics for launcher, bind, web dir, data dir, and Claude CLI readiness. | P1 | Misconfiguration still requires terminal debugging. | Settings + Runtime diagnostics | Settings groups fields by purpose, validates inputs, and exposes restart-needed/resolved-config state. |
| Responsive | Desktop/tablet/mobile breakpoints exist, but layout needs stronger automated guarantees against overlap, overflow, blank panels, and composer obstruction. | P0 | Narrow or constrained viewports can make remote work unusable. | Responsive shell + QA | Playwright visual smoke covers wide desktop, desktop, and narrow with layout assertions rather than pixel snapshots. |
| Empty states | Conversation starter exists, but no sessions, no tasks, no search results, archived, loading, and error states are not yet a unified native-like system. | P1 | First-run and recovery states feel less guided. | Empty states + Product language | Empty conversation, no session, no tasks, no results, archived, and API error states have automated or manual acceptance coverage. |
| Native integration | Browser UI lacks native desktop affordances such as notifications, menu/dock actions, file drag/drop, global shortcut, and OS window state. | P2 | Acceptable for remote web MVP, but caps Claude App parity. | Native wrapper / Distribution | Keep web MVP explicit and document native affordances as out of scope until a wrapper exists. |

## Regression Checklist

### Information Architecture And Navigation

- Sessions, Config/Settings, and Archived destinations are reachable from primary navigation.
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
- Raw event details remain accessible and collapsed by default.
- Task cards show status, source, title, summary, and session context without widening the inspector.

### Responsive And Empty States

- At 1440px, rail, session sidebar, conversation, inspector, event stream, and composer have non-empty boxes.
- At 1024px, inspector behavior does not shrink or overlap the conversation unexpectedly.
- At 390px, rail/sidebar/workspace/inspector/autocomplete/composer fit without horizontal page scroll.
- Conversation and inspector can scroll independently when content is tall.
- Empty conversation starter remains visible and does not collide with composer.
- Empty search results, no-task inspector panels, archived sessions, and config workspace fit at all visual-smoke viewports.

## Automated Coverage Added

`web/e2e/visual.spec.ts` uses Playwright layout assertions instead of screenshot snapshots. The mocked fixture covers long paths, long branch names, stopped and archived sessions, config workspace fields, long task titles/summaries, long message tokens, tool/task blocks, failed Bash output, autocomplete, a long multiline composer draft, an empty conversation starter, empty search results, and a no-task session across wide desktop, desktop, and narrow viewports.

The smoke guards against blank regions, viewport overflow, element overflow, sidebar/workspace/inspector collisions, config inheriting chat-only regions, failed tool output being hidden, long composer drafts losing their internal scroll cap, composer obstruction of the event stream, and autocomplete covering typed text.

Not covered yet: real Claude CLI stream permutations beyond local fixtures, no-session/API-loading/API-error states, native desktop affordances, and pixel-perfect comparison to Claude App.
