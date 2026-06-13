# Visual Layout Verification

Run the browser layout smoke tests with:

```sh
npm --prefix web run test:visual
```

The tests start the Vite dev server, mock the Claude Remote Web API and WebSocket stream, and exercise wide desktop, ordinary desktop, and narrow mobile-ish viewports. They check that the session sidebar, conversation blocks, tool/task blocks, inspector, composer, and slash-command autocomplete render with non-empty boxes, without horizontal page overflow, and without meaningful viewport-level overlap.
