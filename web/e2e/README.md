# Visual Layout Verification

Run the browser layout smoke tests with:

```sh
npm --prefix web run test:visual
```

The tests start the Vite dev server, mock the Claude Remote Web API and WebSocket stream, and exercise wide desktop, ordinary desktop, and narrow mobile-ish viewports. They check that the session sidebar, conversation blocks, tool/task blocks, inspector, composer, and slash-command autocomplete render with non-empty boxes, without horizontal page overflow, and without meaningful viewport-level overlap.

Coverage is assertion-based rather than screenshot snapshot-based. The fixtures include long session paths, a long worktree branch, long task titles/summaries, long message tokens, background Bash and Agent task blocks, slash-command autocomplete, and an empty conversation starter. The assertions guard against blank regions, viewport overflow, element overflow, sidebar/workspace/inspector collisions, composer obstruction of the scrollable conversation, and autocomplete covering typed text.

When debugging a failure, run a single viewport first:

```sh
npm --prefix web run test:visual -- --project=wide-desktop
npm --prefix web run test:visual -- --project=desktop
npm --prefix web run test:visual -- --project=narrow
```
