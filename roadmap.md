# Claude App-like Web App Roadmap

## 总体目标

本项目的核心目标是让 Claude Remote Web 的 Web App 在桌面端获得尽量接近 Claude App 的功能、体验和 UI 交互。手机体验短期内不作为重点。

当前项目已经具备“远程 Claude Code 会话控制台”的核心骨架，但离“Claude App 级体验”主要差在三类：

1. **信息架构仍偏运维/控制台**  
   当前是 session sidebar + conversation + inspector 的强开发者布局，很多 cwd、worktree、permission、diagnostics 信息常驻展示。Claude App 更偏“聊天优先，细节可展开”。

2. **关键交互语义还不完整**  
   尤其是：
   - “停止生成”与“停止整个 session”没有分离；
   - permission / tool approval 目前更多是只读提示；
   - 附件、文件、diff、改动审查、rename 等聊天产品常见能力不足。

3. **后端能力决定了部分 Claude App parity 的上限**  
   现在后端主要是包装本机 `claude` CLI 的 stream-json 输入/输出。只要继续走这个架构，就必须先确认 Claude Code CLI 是否在 stream-json 协议里支持 permission decision、interrupt、rich content 等能力；否则前端只能做“提示/模拟”，不能做到真正交互闭环。

## 当前现状简述

### 前端现状

前端核心入口在 `web/src/App.tsx`，布局由 `web/src/AppShell.tsx` 组织。当前体验大致是：

- 左侧 session 列表：`web/src/SessionSidebar.tsx`
  - 有 active / archived 模式、搜索、pinned、按时间分组；
  - 已经接近聊天历史列表，但 session row 里仍暴露较多项目路径、worktree、状态细节。

- 中间 conversation workspace：`web/src/ConversationWorkspace.tsx`
  - 同时承担新建会话、config view、会话 header、worktree panel、review card、transcript、composer；
  - header 里直接展示 cwd、worktree、Stop/Restart/Archive/Delete 等重操作，控制台感较强。

- composer：`web/src/Composer.tsx`
  - 支持 slash autocomplete、context attachment、prompt history、send/stop；
  - 当前 attachment 主要被序列化为文本或 `@path`，不是 Claude App 那种一等附件体验，相关逻辑在 `web/src/useComposerState.ts`。

- transcript 渲染：`web/src/ConversationBlockList.tsx`、`web/src/conversationBlocks.ts`
  - 已经能把 raw event 聚合成 message/tool/task/error/raw block；
  - 但整体仍更偏 Claude Code observability，而不是 Claude App 的“消息优先 + 工具过程折叠”。

- inspector：`web/src/InspectorPanel.tsx`
  - Activity / Session tasks / All tasks / Plan / Diagnostics 很有用；
  - 但 Diagnostics、config、raw payload 对普通聊天主流程来说过重。

### 后端现状

后端 API 在 `crates/server/src/api.rs` 组织，能力包括：

- session lifecycle：create/input/stop/restart/resume/archive/delete；
- transcript REST + WebSocket replay/live；
- task projection；
- worktree create/status/remove；
- config / diagnostics。

核心约束：

- 输入目前是纯文本，`InputRequest` 只有 `text`，见 `crates/server/src/api.rs`。
- `claude` 子进程通过 pipe stdin/stdout/stderr 驱动，不是 PTY，见 `crates/server/src/process.rs`。
- stop 当前是 hard kill，不是 graceful interrupt，见 `crates/server/src/process.rs`。
- 无 session rename/update endpoint。
- 无真实 permission approve/deny API。
- transcript storage 是 JSONL 全量扫描，长会话后会遇到性能问题，见 `crates/server/src/store.rs`。
- 仍坚持 SSH-only / `127.0.0.1` 默认安全姿态，这是项目约束，不能为了“像 Claude App”改成公网暴露。

## 规划原则

### 1. 不做“像素级复制”，做“信息层级和交互语义接近”

Claude App 的核心不是某个颜色或按钮样式，而是：

- 新聊天入口自然；
- 历史会话易扫；
- 主区域永远围绕对话；
- 工具/文件/任务是可展开的上下文，而不是抢占主界面；
- 用户遇到“需要我决策”的地方能直接行动。

所以短期应优先做 **chat-first IA**，而不是继续堆 diagnostics 面板。

### 2. 保持 remote devbox / SSH-local 架构

项目文档明确要求默认访问路径是：

```text
local browser -> SSH local port forward -> devbox 127.0.0.1:8787 -> Rust daemon -> Claude launcher
```

所以 roadmap 不应以“公开 Web SaaS”或“浏览器直接读 devbox 文件”为目标。文件浏览、上传、git 操作都应通过后端受控 API 或 Claude Code 自己处理。

### 3. 功能 parity 分成两层

- **可立即做的 UI/产品层 parity**：布局、composer、transcript、session list、设置收纳、快捷键、rename、diff view 等。
- **依赖 CLI/协议能力的 deep parity**：permission approval、interrupt current turn、rich attachments、model/account 状态等，需要先验证 Claude Code stream-json 能力。

## 建议迭代路线

## Phase 0：明确 parity 目标与技术边界

**目标：** 不急着动 UI，先把“我们要像 Claude App 到什么程度”写成一份内部目标清单。

建议输出一份 specs 文档，包含：

1. Chat-first shell 目标；
2. Permission / interrupt / attachment 等能力的协议依赖；
3. 不改变 SSH-only 默认安全姿态；
4. 不做移动端；
5. 哪些功能先做 UI，哪些必须等后端能力。

**同时做一次协议验证：**

- 研究当前 Claude Code `--input-format stream-json --output-format stream-json` 是否能：
  - graceful interrupt 当前 turn；
  - approve / deny permission；
  - 表达 image/file content blocks；
  - 暴露 model/account/status；
  - 区分 tool pending / requires action。

验证结论（2026-06-14）：

- raw CLI `stream-json` stdin 没有稳定公开的 graceful interrupt 控制帧；本地向运行中的 CLI 发送 `{"type":"interrupt"}` 未中断正在执行的 Bash tool。
- raw CLI `stream-json` stdin 没有稳定公开的 permission approve / deny 控制帧；当前只能通过启动时 `--permission-mode`、allowed/disallowed tools、settings/hooks 配置策略。
- user message schema 可表达文本，官方 Agent SDK/MessageParam 路径支持 text + image content blocks；raw CLI 对 document/file content blocks 仍需单独验证。
- `system/init` stdout 会暴露 model、tools、MCP servers、permission mode、slash commands、API key source、Claude Code version 等初始化信息；没有发现 raw stdin 查询 model/account/status 的控制请求。
- 没有发现 raw CLI stdout 中通用的 `requires_action` / `pending_action` 事件；Agent SDK 有更高层的 permission/user-input 控制回调。

因此在继续使用 raw `claude -p --input-format stream-json --output-format stream-json` 架构时，Phase 3/4/6 需要降级：不提供假的 stop-generating 或 approve/deny；需要真正闭环时应评估迁移到 Claude Agent SDK 控制层或等待 CLI 暴露稳定控制协议。

## Phase 1：Chat-first 外壳改造

**目标：** 让用户打开 Web App 的第一感受从“远程守护进程控制台”变成“Claude 聊天工作台”。

### 1.1 新建会话入口重构

当前 `ProjectHome` 的主问题是 “Where should Claude work?”，要求 cwd。建议改成：

- 主视觉：`What can I help with?`
- cwd/project 作为 context selector chip，而不是 hero 的唯一输入。
- 默认预填：
  - last used project；
  - recent projects；
  - current repo；
  - “General / no project” 如果后端支持，或“Choose workspace”作为次级动作。
- advanced options 默认折叠：
  - permission mode；
  - worktree；
  - base ref；
  - launcher/session options。

相关文件：

- `web/src/ProjectHome.tsx`
- `web/src/useSessions.ts`

### 1.2 主 header 降噪

当前 conversation header 展示完整 cwd、worktree、stop/restart/archive/delete。建议：

- 顶部只保留：
  - chat title；
  - workspace short name；
  - running/waiting indicator；
  - “details” 按钮。
- cwd/worktree/permission 放进 context popover。
- Stop/Restart/Archive/Delete 移到 overflow menu，危险动作二次确认。
- “Stop session” 不再是默认主按钮。

相关文件：

- `web/src/ConversationWorkspace.tsx`
- `web/src/Composer.tsx`

### 1.3 Config/Diagnostics 从主导航下沉

当前 `Config` 在 primary rail，Diagnostics 是 inspector tab。对 Claude App-like 来说过重。

建议：

- primary rail 只保留：
  - Chats；
  - maybe Projects；
  - Settings。
- ConfigView 挪到 Settings > Developer / Daemon。
- Diagnostics 仅在有错误时出现入口，或藏在 session details。

相关文件：

- `web/src/AppShell.tsx`
- `web/src/ConfigView.tsx`
- `web/src/InspectorPanel.tsx`

**交付标准：**

- 打开 app 不再像 admin dashboard；
- 用户第一眼看到的是聊天和历史，不是 daemon/config/worktree；
- 所有现有功能仍可访问，但层级更深。

## Phase 2：Transcript 和工具活动体验升级

**目标：** 主对话流像 Claude App；工具/任务细节默认折叠，仍可展开调试。

### 2.1 引入 “simple chat mode” 作为默认渲染策略

当前 transcript 渲染能力已经不错，但 tool/raw/event 信息仍偏重。建议新增展示策略：

- 默认主流只展示：
  - user message；
  - assistant message；
  - compact activity row：  
    “Used Bash”, “Read 3 files”, “Edited 2 files”, “Ran tests”。
- 点击展开才显示：
  - tool input；
  - tool result；
  - raw event；
  - diff / code / stderr。
- Inspector 里继续保留详细 activity timeline。

相关文件：

- `web/src/ConversationBlockList.tsx`
- `web/src/conversationBlocks.ts`
- `web/src/presentationPolicy.ts`

### 2.2 更 Claude-like 的 task/tool block

建议统一工具活动样式：

- bash running：一行 spinner + command 摘要；
- file edit：文件名 + changed lines + “View diff”；
- background task：状态 chip；
- failed action：红色 compact row，可展开 stderr；
- permission-like event：高亮 “Needs your attention”。

### 2.3 空状态和建议 prompt

当前有 empty prompt suggestions，但可以进一步做成 Claude App 风格：

- 当前 workspace 上下文卡片；
- 3–5 个建议任务；
- 最近 session resume；
- 如果 worktree enabled，提示会话隔离能力。

**交付标准：**

- 默认 transcript 不暴露 raw JSON / verbose tool plumbing；
- Debug 能力没有丢，全部通过展开或 inspector 保留；
- 长会话可读性显著提升。

## Phase 3：Composer 和 session 控制语义修正

**目标：** 区分“聊天输入”“停止生成”“停止整个 Claude 进程”“后台任务控制”。

### 3.1 分离 Stop Generation 和 Stop Session

当前 `Composer` 里是 Stop session。Claude App 用户期望的是停止当前响应。

需要后端先支持或验证 graceful interrupt：

- 如果 Claude CLI stream-json 支持 interrupt：
  - 新增 `POST /api/sessions/{id}/interrupt`；
  - 前端按钮为 “Stop generating”；
  - session 不退出，只是当前 turn 停止。
- 如果不支持：
  - UI 文案必须明确：“Stop session”；
  - 放到 header overflow，不放 composer 主路径；
  - composer 主按钮只显示 send/disabled/loading。

相关文件：

- `web/src/Composer.tsx`
- `crates/server/src/process.rs`
- `crates/server/src/api.rs`

### 3.2 Composer 简化

默认状态只保留：

- textarea；
- attach/context 按钮；
- slash/command 按钮；
- send / stop generating。

cwd、permission、branch、source context chips 改成一行 compact context，可点击展开，不要常驻占据输入区。

### 3.3 Slash command 升级为 command palette

当前 `autocomplete.ts` 是静态 slash 列表。建议：

- Cmd/Ctrl+K 打开 command palette；
- slash 输入只是 palette 的一种触发；
- 命令分组：
  - session；
  - Claude Code；
  - view/layout；
  - worktree；
  - diagnostics；
- 常用命令可直接执行 UI action，而不是全部发给 Claude。

相关文件：

- `web/src/autocomplete.ts`
- `web/src/App.tsx`
- `web/src/useComposerState.ts`

**交付标准：**

- 用户不会误点“停止会话”来停止生成；
- composer 更接近 Claude App；
- 高级能力仍保留，但不挤占输入体验。

## Phase 4：Permission / Review / Human-in-the-loop 闭环

**目标：** 把当前只读 review cards 变成真正可操作的 “Claude needs your approval”。

这是最关键的 Claude App parity 项之一。

### 4.1 先验证后端能力

现在前端能识别 review-like events，但 `canAct` 为空或 false，README 也提到 approval/denial 仍需在终端处理。

相关位置：

- `web/src/activityTimeline.ts`
- `web/src/ActivityPanel.tsx`

需要确认 Claude Code CLI 是否能通过 stream-json 接收 permission result。如果能：

- 后端增加 pending approval state；
- 记录 permission prompt event；
- 新增 approve/deny API；
- WebSocket 推送 pending decision；
- 前端 `ReviewCard` 加按钮：
  - Allow once；
  - Deny；
  - Always allow for session；
  - Show details。

如果不能：

- 前端不要假装能 approve；
- 明确提示“请回到终端处理”；
- 或者提供“切换 permission mode / restart with mode”的替代路径。

### 4.2 ReviewCard 统一交互

把以下情况统一成“needs attention”：

- permission prompt；
- risky bash；
- failed task；
- dirty worktree cleanup blocked；
- plan approval；
- external confirmation required。

**交付标准：**

- 如果协议支持，用户可以在浏览器完成 allow/deny；
- 如果协议不支持，UI 如实降级，不给虚假按钮；
- waiting 状态变得可解释、可操作。

## Phase 5：Coding workflow：文件、diff、worktree、提交链路

**目标：** 从“看 Claude 输出”升级到“审查 Claude 改了什么，并推进交付”。

当前 worktree 能创建、status、clean remove，但没有完整 review workflow。

### 5.1 Read-only file/diff APIs

先做只读，风险低：

- `GET /api/sessions/{id}/files?path=...`
- `GET /api/sessions/{id}/diff`
- `GET /api/sessions/{id}/diff?file=...`
- `GET /api/sessions/{id}/worktree-status` 已有，可增强。

前端：

- worktree panel 展示 changed files；
- 点击文件打开 diff viewer；
- transcript 中 tool edit block 可跳到 diff。

相关文件：

- `crates/server/src/worktree.rs`
- `crates/server/src/api.rs`
- `web/src/ConversationWorkspace.tsx`
- `web/src/ActivityPanel.tsx`

### 5.2 后续增加 git action

在安全确认下增加：

- discard file；
- stage/unstage；
- commit；
- push branch；
- create PR；
- stop and remove dirty worktree with explicit confirmation。

这些都必须保留 SSH-local、安全确认、只操作 app-created worktree 的原则。

### 5.3 Session 与 worktree 关系可视化

Claude App-like 的 coding experience 应该让用户知道：

- 当前 session 在哪个 repo；
- 是否 isolated worktree；
- base ref；
- changed files；
- cleanup status；
- branch 可如何交付。

但这些不应常驻 header，应在 “Changes” 或 inspector tab 中集中呈现。

**交付标准：**

- 用户不用读 transcript 就能知道 Claude 改了什么；
- 可以在 Web UI 做基本 code review；
- worktree 安全边界不被破坏。

## Phase 6：Attachments / Context 体验

**目标：** 从“把附件拼进 prompt 文本”升级到“上下文一等对象”。

### 6.1 先做 repo path attachment 的体验升级

当前 path attachment 最终变成 `@path`，这是符合 Claude Code 的，但 UI 可以更好：

- `@` autocomplete repo paths；
- path chip；
- invalid path 提示；
- recent files；
- selected changed files；
- drag a file path from changed files into composer。

后端可以提供受限 repo path validation/search API，但注意项目文档说浏览器不是任意 devbox file browser。

### 6.2 pasted text / snippets 一等化

当前 pasted text 被 fenced block 拼接。可以优化：

- snippet card；
- title / language；
- collapse preview；
- token estimate；
- 发送时仍可降级为 text block。

### 6.3 文件/图片附件：需要架构决策

如果要像 Claude App 支持图片/文件，有两种路线：

1. **继续走 Claude Code CLI**  
   上传到 devbox 临时目录，再用 `@path` 或 prompt 指令引用。优点符合 remote devbox；缺点不是一等 content block。

2. **后端改成支持 structured input content**  
   但当前后端只是给 Claude CLI 写 stream-json 用户文本。是否支持 image/document content 取决于 Claude Code CLI stream-json。

短期建议不要先做复杂上传；先把 repo path + pasted text 做好。

相关文件：

- `web/src/Composer.tsx`
- `web/src/useComposerState.ts`
- `crates/server/src/api.rs`
- `crates/server/src/process.rs`

**交付标准：**

- 代码上下文引用体验接近 Claude Code / Claude App；
- 不把浏览器变成任意文件浏览器；
- 文件上传能力等协议确认后再做。

## Phase 7：Session 管理能力补齐

**目标：** 让 session/chats 更像 Claude App 的 conversation management。

### 7.1 Session rename/update API

后端新增：

```http
PATCH /api/sessions/{id}
{
  "name": "..."
}
```

前端：

- sidebar inline rename；
- header rename；
- auto-generated title 可编辑。

相关：

- `crates/server/src/store.rs`
- `crates/server/src/session.rs`
- `web/src/SessionSidebar.tsx`

### 7.2 Session grouping / project organization

当前已有按时间 grouping 和 pinning。后续增强：

- project group；
- recent projects；
- search title + cwd + last message；
- archived filter 更自然；
- waiting/needs attention 优先排序；
- “continue where I left off”。

### 7.3 Transcript export/share

在 SSH-local 工具里，share 不是第一优先级，但 export 很有用：

- export markdown；
- export raw JSONL；
- copy conversation；
- save diagnostics bundle。

**交付标准：**

- 历史会话管理从“进程列表”变成“聊天列表”；
- 用户可以重命名、查找、恢复、归档。

## Phase 8：可靠性和长会话性能

**目标：** 支撑 Claude Code 长时间运行，避免 UI 越用越慢。

### 8.1 Transcript pagination/indexing

当前 `load_events_after` 和 `next_event_id` 会扫描 JSONL。长会话、多会话后会成为瓶颈。

建议：

- meta 中保存 next event id；
- transcript API 支持 `limit`；
- UI 虚拟列表；
- old events lazy load；
- block-level memoization。

相关：

- `crates/server/src/store.rs`
- `web/src/useSessionEvents.ts`

### 8.2 WebSocket 协议增强

当前 WebSocket 直接发 `UiEvent`。建议引入 envelope：

```json
{ "type": "event", "event": { }, "serverTime": "..." }
{ "type": "heartbeat", "serverTime": "..." }
{ "type": "error", "error": { } }
```

前端：

- stale connection indicator；
- reconnect with afterId；
- missed-event recovery；
- clear loading/error states。

相关：

- `crates/server/src/api.rs`
- `web/src/useSessionEvents.ts`

### 8.3 Diagnostics 降噪但增强故障引导

不要让 diagnostics 常驻主路径，但当 session failed 时：

- 用自然语言解释；
- 给一键复制 troubleshooting bundle；
- 显示 launcher/config/stderr 的最小必要信息。

**交付标准：**

- 长会话不会卡顿；
- 断线重连可靠；
- 错误状态用户知道下一步做什么。

## Phase 9：Claude App 级视觉和交互动效 polish

**目标：** 在前面语义修正后，再做视觉 polish，否则容易只是“换皮”。

建议范围：

- 更轻的左侧栏；
- message bubble / markdown / code block 细节；
- tool activity micro-interaction；
- resizable panes + persisted width；
- focus management；
- keyboard shortcut overlay；
- command palette；
- empty state；
- subtle transitions；
- app theme tokens。

相关：

- `web/src/App.css`
- `web/src/AppShell.tsx`
- `web/src/ConversationBlockList.tsx`

## 优先级排序

如果按投入产出比，建议这样排：

### P0：必须先做

1. **协议能力验证**
   - permission approval；
   - interrupt；
   - rich content；
   - model/account status。

2. **Chat-first UI 降噪**
   - start surface；
   - header；
   - config/diagnostics 下沉；
   - composer 简化。

3. **simple chat transcript mode**
   - tool 默认折叠；
   - raw details 移到展开/inspector。

### P1：强烈建议紧接着做

4. **Stop generating vs Stop session 分离**
5. **session rename / management**
6. **worktree changed files + diff viewer**
7. **actionable review/permission flow，如果协议支持**

### P2：增强体验

8. **context attachments 一等化**
9. **command palette**
10. **transcript pagination + WS heartbeat**
11. **notifications / task finished 提醒**
12. **git commit/push/PR workflow**

## 推荐的近期 4 个 Sprint

### Sprint 1：Claude-like shell v2

交付：

- 新 chat-first ProjectHome；
- conversation header 降噪；
- session details popover；
- config/diagnostics 下沉；
- composer 移除常驻技术 chips；
- 保持现有测试通过。

主要改动：

- `web/src/ProjectHome.tsx`
- `web/src/ConversationWorkspace.tsx`
- `web/src/Composer.tsx`
- `web/src/AppShell.tsx`
- `web/src/App.css`

### Sprint 2：Simple transcript mode

交付：

- 默认 message-first；
- compact tool rows；
- raw/tool details expandable；
- inspector 保留详细 activity；
- failed/risky/waiting 状态更醒目。

主要改动：

- `web/src/ConversationBlockList.tsx`
- `web/src/conversationBlocks.ts`
- `web/src/presentationPolicy.ts`
- `web/src/ActivityPanel.tsx`

### Sprint 3：Session semantics

交付：

- session rename API + UI；
- stop generating 能力验证；
- 若支持 interrupt，新增 interrupt API；
- 若不支持，重命名 UI，避免误导；
- archive/delete/restart 进入 overflow menu。

主要改动：

- `crates/server/src/api.rs`
- `crates/server/src/session.rs`
- `crates/server/src/process.rs`
- `crates/server/src/store.rs`
- `web/src/api.ts`
- `web/src/useSessions.ts`
- `web/src/ConversationWorkspace.tsx`
- `web/src/Composer.tsx`

### Sprint 4：Changes / diff review

交付：

- worktree changed files panel；
- read-only diff API；
- diff viewer；
- transcript edit/tool block 可跳转文件 diff；
- dirty worktree cleanup flow 更清楚。

主要改动：

- `crates/server/src/worktree.rs`
- `crates/server/src/api.rs`
- `web/src/api.ts`
- 新增 diff/changelist components。

## 关键风险

1. **Permission approval 可能被 CLI 协议卡住**  
   如果 Claude Code stream-json 不支持 Web 侧 approve/deny，那么只能做提示或要求用户回终端。

2. **Interrupt 可能不是简单 stdin 消息**  
   当前 hard kill 会破坏 Claude App-like 的“停止生成但保留会话”。需要确认 CLI 有没有安全中断机制。

3. **附件能力不能盲目照搬 Claude API**  
   Claude API 支持 image/document/file content blocks，但本项目现在是 Claude Code CLI wrapper，不是直接调用 Messages API。不能假设 API 能力自动等于 Claude Code stream-json 能力。

4. **不要牺牲 SSH-local 安全模型**  
   为了做 file browser、upload、git action，很容易扩大攻击面。所有 devbox 文件/命令能力都应受 cwd、worktree、confirmation 约束。

5. **过早做视觉 polish 会浪费**  
   先修信息层级和交互语义，再调视觉，否则只是“漂亮的控制台”。

## 当前闭环状态（2026-06-14）

| Roadmap 差距 | 当前状态 | 处理方式 |
| --- | --- | --- |
| 协议能力验证 | 已完成 | 已验证 raw Claude Code CLI `stream-json` 的 interrupt、permission decision、rich content、model/status、pending action 能力边界，并记录在 Phase 0。 |
| Chat-first shell | 已完成第一轮 | New chat hero 改为 chat-first；header 降噪；technical details 进入 `Chat details`；Settings 下沉；session 重操作进入 overflow。 |
| Simple transcript mode | 已完成第一轮 | tool/raw details 默认折叠，主流 message-first；详细调试仍可展开或在 inspector 查看。 |
| Stop generating vs Stop session | 已降级闭环 | raw CLI 未发现稳定 interrupt 控制帧；composer 不再提供 misleading stop session，结束 session 下沉到 overflow。真正 Stop Generating 需要 Agent SDK/control protocol。 |
| Permission approve/deny | 已降级闭环 | raw CLI 未发现稳定 approve/deny 控制帧；UI 不提供假按钮，提供 attention/review/copy terminal handoff。真正浏览器审批需要 Agent SDK/control protocol。 |
| Session rename / management | 已完成第一轮 | 新增 `PATCH /api/sessions/{id}` 和 header rename UI。 |
| Worktree changed files + diff viewer | 已完成第一轮 | 新增 read-only `GET /api/sessions/{id}/worktree-diff` 和 dirty worktree diff viewer。 |
| Context attachments 一等化 | 已完成第一轮 | pasted text 显示 snippet card；changed files 可直接 attach 为 repo path context；发送仍降级到 text/@path，符合当前 CLI 架构。 |
| Command palette | 已完成第一轮 | 支持 searchable quick launcher、chat switcher、keyboard navigation、action type badges。 |
| Notifications | 已完成第一轮 | attention toast + opt-in browser notifications。 |
| 长会话性能 | 已完成第一轮 | transcript 支持 `limit` / `beforeId`，前端初始加载有界，并限制每 session 内存事件数量。 |
| Git commit/push/PR workflow | 未做 | 属于高风险写操作；需单独安全设计、确认范围和 UX。 |
| Rich file/image uploads | 未做 | 受 Claude Code raw CLI content block 能力和 devbox安全模型限制；需单独协议/架构设计。 |

因此，当前目标不应被表述为“完全复制 Claude App”，而是已经把 roadmap 中可在当前 raw CLI + SSH-local 架构下闭环的高优先级差距推进到第一版；剩余未做项主要是高风险写操作或需要 Agent SDK/control protocol 的深层 parity。

## 一句话路线图

短期不要先追“Claude App 长得一模一样”，而应先把 Web App 从“远程 Claude Code 控制台”推进到“聊天优先的 Claude Code 工作台”：主界面只放聊天和少量状态，工具/任务/diagnostics 全部渐进展开；然后补齐 stop generating、permission approval、rename、diff review、attachments 这些会直接影响 Claude App 体感的能力。
