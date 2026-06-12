# AGENTS.md

## Output UX guidance

When changing Claude output rendering, prefer Claude Code app behavior where practical. The browser UI should present a readable conversation and task timeline, not expose raw transport details as the primary experience.

- Show assistant/user/system text as readable conversation content.
- Show ordinary tool calls as compact activity with useful input/result summaries.
- Show background Bash work, Agent/subagent work, Workflow runs, and task-list updates as task or subagent activity rather than generic tool use.
- Keep raw event payloads available in collapsed details for debugging and replay.
- Preserve the append-only event log model.
- Keep the default security posture SSH-local and bound to `127.0.0.1` unless a future change explicitly designs otherwise.
