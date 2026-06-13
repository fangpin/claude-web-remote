# Visual Layout Verification

Run the browser layout smoke tests with:

```sh
npm --prefix web run test:visual
```

The tests start the Vite dev server, mock the Claude Remote Web API and WebSocket stream, and exercise wide desktop, ordinary desktop, and narrow mobile-ish viewports. They check that the session sidebar, archived sessions, config workspace, conversation blocks, tool/task blocks, inspector, composer, and slash-command autocomplete render with non-empty boxes, without horizontal page overflow, and without meaningful viewport-level overlap.

Coverage is assertion-based rather than screenshot snapshot-based. The fixtures include long session paths, a long worktree branch, stopped and archived sessions, config values, long task titles/summaries, long message tokens, background Bash and Agent task blocks, failed Bash output, slash-command autocomplete, a long multiline composer draft, an empty conversation starter, empty search results, and a no-task session. The assertions guard against blank regions, viewport overflow, element overflow, sidebar/workspace/inspector collisions, composer obstruction of the scrollable conversation, config inheriting chat-only regions, failed output being hidden, and autocomplete covering typed text.

When debugging a failure, run a single viewport first:

```sh
npm --prefix web run test:visual -- --project=wide-desktop
npm --prefix web run test:visual -- --project=desktop
npm --prefix web run test:visual -- --project=narrow
```
