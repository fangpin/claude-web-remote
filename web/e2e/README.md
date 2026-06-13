# Visual Layout Verification

Run the browser layout and visual regression suite with:

```sh
npm --prefix web run test:visual
```

The tests start the Vite dev server, mock the Claude Remote Web API, transcript replay, and WebSocket stream, and exercise wide desktop, ordinary desktop, and narrow mobile-ish viewports. They do not require a real Claude CLI process or network access.

The suite has two layers:

- Layout smoke assertions verify that the session sidebar, archived sessions, config workspace, conversation blocks, tool/task blocks, inspector, composer, and slash-command autocomplete render with non-empty boxes, without horizontal page overflow, and without meaningful viewport-level overlap.
- Screenshot baselines guard chat-focused, native-like states including empty/start screens, grouped active sessions with a `pin/...` worktree branch, archived read-only history, markdown/code/diff rendering, tool activity and inspector timelines, waiting/risk review, failed/error output, narrow multiline composer/autocomplete, and long-conversation bottom scroll.

The fixtures include long session paths, a long worktree branch, stopped/starting/running/waiting/failed/archived sessions, config values, long task titles/summaries, long message tokens, background Bash and Agent task blocks, failed Bash output, explicit error events, slash-command autocomplete, a long multiline composer draft, an empty conversation starter, empty search results, no-task sessions, and long transcript history. Playwright fixes viewport, locale, timezone, light color scheme, reduced motion, hidden carets, and screenshot animation handling to reduce flakes.

Update screenshots only when an intentional visual change has been reviewed:

```sh
npm --prefix web run test:visual -- --update-snapshots
```

When debugging a failure, run a single viewport first:

```sh
npm --prefix web run test:visual -- --project=wide-desktop
npm --prefix web run test:visual -- --project=desktop
npm --prefix web run test:visual -- --project=narrow
```

Run one scenario with Playwright's grep flag:

```sh
npm --prefix web run test:visual -- -g "active chat markdown"
```

Keep visual fixture data under `web/e2e`; do not add production UI branches just to satisfy a baseline.
