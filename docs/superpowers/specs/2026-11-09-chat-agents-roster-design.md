# Agents in the Chat: roster, agent sheet, typing state — design

**Status:** Built on feat/chat-agents-roster (2026-11-09); not yet released.

## Intent

The Chat view (desktop and, since 0.32.2, the phone) reads Claude's transcript and renders the conversation. Two things the terminal shows are missing from it:

1. **Running agents.** Claude Code's TUI paints a live list under the input box: `● main / ○ general-purpose  Ch…  33s · ↓ 125.1k tokens` and "Waiting for 1 background agent to finish". The Chat shows none of it. A background agent's tool call is recorded with an immediate result ("Async agent launched successfully"), so the Chat marks the step done at once and folds it into a collapsed "Ran 1 agent" row. The agent's completion arrives later as a harness notification the Chat hides. On a phone, where the Chat is now the default, the user cannot tell whether Claude is waiting on helpers or stuck.
2. **Dead air while Claude writes.** Claude Code appends an assistant text block to the transcript only once it is complete (verified: a 2,900-character reply lands as one line with `stop_reason` set). The Chat cannot stream what the file never holds, but it can say that a reply is coming.

This design adds an **agent roster** read from Claude Code's own per-agent transcripts, shows it as a strip in the Chat and as a chip on session rows, lets the user **open an agent** to read what it is doing, and adds a **typing state** for the reply gap.

The user asked for three things in this order: see running agents in the Chat; align what the Chat and the session list say; look inside an agent. Streaming text was asked for and ruled out (see Non-goals); the typing state is the honest substitute.

## Goals

- The Chat shows which agents a Claude session has out right now, with the agent type, what it was asked, how long it has been running, its output tokens so far, and its latest tool step.
- The same roster feeds a count chip on the mobile session row and the desktop tile header, from one server-side source, so the list and the Chat never disagree.
- Tapping an agent opens its own conversation (prompt, text, tool steps, results), live while it runs and readable after it finishes.
- While Claude is working and no reply is recorded yet, the Chat shows a typing row where the reply will land.
- Phone and desktop get all of it through the shared `ChatView`; the phone adds nothing of its own except layout.

## Non-goals

- **Streaming Claude's text as it types.** The transcript does not carry partial text. Scraping the terminal mirror for it would parse a width-wrapped, Markdown-rendered, region-repainted TUI and break on Claude Code releases. Not built. If Claude Code ever writes partial text or fires a per-token hook, the typing row becomes the slot where it lands.
- Talking to a subagent. An agent sheet has no composer; there is no channel to a subagent.
- Historical agent analytics (cost per agent over time, totals across sessions). The roster is about now; finished agents remain readable through the sheet, nothing more.
- Agents of non-Claude sessions. Codex and Gemini have no transcript the Chat reads.

## Anti-goals (what would make this a failure)

- A strip that says "running" after the agent finished, or shows an agent that never existed, because the detection guessed. Running must come from Claude Code's own `finished` flag, with the main transcript's completion notification as the fallback, never from timing heuristics.
- A roster that costs more than it tells: re-reading 400 KB agent files every second per agent. Reads must be incremental.
- Another socket subscription model next to the Chat's. The roster rides the existing session update path so every client that lists sessions has it.
- A typing row that lies: shown while Claude waits for a permission answer, or after the turn ended.

## Current state (verified in code, 2026-11-09)

- Transcript location: `~/.claude/projects/<project-slug>/<conversationId>.jsonl` (and `$CLAUDE_CONFIG_DIR/projects`). The server learns the path from Claude's hooks (`SessionManager.applyAgentMeta` → `SessionUsageTracker.setTranscript`), validates it with `resolveTranscriptPath` (must be a `*.jsonl` under a known root, symlinks resolved).
- **Agent transcripts** live next to it: `<project-slug>/<conversationId>/subagents/agent-<id>.jsonl` plus `agent-<id>.meta.json`. Verified on this machine for a session with two reviewer agents. The meta file holds:
  `{"agentType":"pre-push-reviewer","isBuiltIn":false,"launchedWithDefaults":true,"description":"Delta review of fix commit","toolUseId":"toolu_…","spawnDepth":1,"requestShape":"background","requestNonInteractive":true,"pickedEffortModel":"claude-fable-5-1","finished":true}`.
  The jsonl is the same entry format as the main transcript: `type` user/assistant, `timestamp`, `agentId`, `isSidechain: true`, `message.content` blocks (text, thinking, tool_use), `message.usage` with `output_tokens` on assistant entries, and tool results as user entries.
- Main transcript, Agent tool call: `tool_use` named `Agent` with input `{subagent_type, description, prompt, run_in_background?}`; its `tool_result` is immediate for background agents ("Async agent launched successfully … agentId: <id>"). Completion arrives as a `user` entry whose string content starts with `<task-notification>` carrying `<tool-use-id>` (the Agent call's id) and `<status>`. `ChatTail` already hides such entries (`FOREIGN_QUEUED_RE`, "harness-injected meta prompts").
- Chat feed: `SessionManager.openChat` starts `SessionUsageTracker.openChat(cb)` on the first viewer; updates go to the `chatRoom(id)` socket room as `session:chat` (`ChatUpdate`: `reset`, `available`, `messages`, `permissionMode`, `modelSet`, `commands`, `suggestion`, `queue`, `removed`). `ChatTail extends JsonlTailer` (byte-position incremental reads, `poll()`), one per transcript path.
- Tool steps: `server/src/services/usage/chatTools.ts` makes a `ChatToolBlock` (`id`, `name`, `label`, `status: pending|ok|error|blocked`, `detail`) per `tool_use`; `withResult` folds the result in. Client `toolSteps.ts` merges consecutive tool-only messages into one group, `ChatToolGroup` renders the group summary ("Ran 1 agent (1 running)") collapsed by default with a spinner for pending steps. `Agent`/`Task` steps are labelled by `description`.
- Session status for everyone: `session:status` broadcast (`{sessionId, status, lastPrompt}`); `SessionInfo.usage` carries the session's own token meter (`SessionUsage`). Mobile rows (`client/src/app/mobile/Sessions.tsx`) and the desktop tile header (`Mosaic.tsx`, `Focus.tsx`) already render chips next to the status pill (`PrChip`, `StaleChip`, `UsageChip`).
- Activity timeline (desktop): hooks `SubagentStop` produce a `subagent` activity event ("<type> finished"), and only with the activity beta on. Nothing records a start.
- **Session status while agents run (verified in this machine's transcripts, builder check 2026-11-09):** right after launching a background agent the main assistant ends its turn (`stop_reason: end_turn` → Stop hook → `idle`); the agent keeps running for tens of seconds until its `<task-notification>` wakes the main turn. So a session with helpers out is `idle` by the hooks' definition for most of that time. If Claude Code also runs Argus's unmatched `PreToolUse` hook inside subagents, each agent tool call flips the session to `running` with no Stop until the main turn resumes. Nothing in this design may gate on `running` to mean "agents at work".
- **`finished` is young:** the meta flag is written by Claude Code ≥ 2.1.301 only. On this machine 497 of 540 unfinished meta files come from 2.1.286–2.1.300 and will never get it, and ~72 agents have neither the flag nor a task notification (interrupted turns, killed sessions, Argus restarts).
- **No existing tick:** `SessionUsageTracker` has no cadence of its own: a 400 ms debounce on hook nudges, plus a 1 s interval only while a Chat viewer is open. The roster needs its own driver.
- **Agent file sizes:** reviewer agents here run 300 KB–1.4 MB each; one conversation folder holds 22 agents / 33 MB. Reading every finished agent's jsonl on first sight is not acceptable.
- `parentAgentId` is already present in the meta file of a `spawnDepth: 2` agent; nested agents live in the same `subagents/` folder. Meta is written at launch, so the folder listing detects a start.
- Mobile: `ChatView` is mounted by `client/src/app/mobile/Focus.tsx` in chat mode (the default since 0.33.0: `MobileApp.tsx` passes `'chat'` as the fallback); the terminal unmounts in that mode.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Source of truth for "running" | An agent is **running** when its meta file exists without `finished` **and** its jsonl entries carry a Claude Code `version` ≥ 2.1.301 (older writers never set the flag; those agents are listed from meta as finished, never as running). It stops running on the first of: meta `finished`; the main transcript's `<task-notification>` naming its `toolUseId` or `agentId`; a non-background Agent call's own `tool_result`; the session exiting, restarting, or changing transcript (`/clear`, resume) → `failed`. No elapsed-time rule decides finished. A row whose jsonl has not grown for 5 min stays running but shows "no output for N min" instead of its last step, so a stale row tells the truth about itself. |
| D2 | Who reads the agent files | `SessionUsageTracker` owns an `AgentRoster` per transcript, so the roster exists without a Chat viewer. The always-on `TranscriptTailer` (not `ChatTail`, which lives only while a Chat is open) parses the task notifications for D1. |
| D3 | Transport | One new broadcast `session:agents` (`{sessionId, agents: AgentRun[]}`) to all clients, like `session:status`. The Chat strip and the row chips read the same client store. No roster inside `ChatUpdate`. |
| D4 | Reading cost and poll driver | The roster drives its own 1 s timer while **any agent is unfinished**, whatever the session status (see Current state), plus one listing on every hook nudge; no timer when nothing is unfinished. Per tick: `readdir` + `stat` per meta file; a meta file is re-read only when its mtime changed. One incremental `JsonlTailer` per **unfinished** agent only. Agents already finished at first sight are listed from meta alone (type, description, depth, parent, finished) with no jsonl read: no tokens, no elapsed. `TranscriptFs` gains `readdir` and `mtime` on `stat`. |
| D5 | What an agent row shows | Type · description · elapsed · output tokens · latest tool step (label + spinner/ok/error). Elapsed ticks on the client from `startedAt`. |
| D6 | Where it shows | Chat: a strip between the messages and the composer, the slot the terminal uses. Session list: a chip "N agents" (running count) beside the status pill on the mobile row and the desktop tile header. |
| D7 | Finished agents | A row the roster watched finish leaves the strip 10 s later, with a tick. Agents found already finished never enter the strip. All stay readable: the Agent tool step in the conversation opens the sheet. |
| D8 | Inside an agent | A read-only sheet (desktop: a `Sheet`; phone: full-screen like the Diff screen) rendering the agent's jsonl through `ChatTail` as `ChatMessage[]` with `ChatMessageItem`/`ChatToolGroup`. Live while running by refetching on each roster update; no composer. |
| D9 | Sheet transport | REST `GET /api/sessions/:id/agents/:agentId/chat?after=<byteOffset>` returning `{ available, messages, offset }`: the first call reads the file from 0, later calls return only entries appended past `after` and the new offset, so a phone over ngrok never re-downloads a 1 MB file. The client appends by id and refetches when the agent's roster entry changes while running. No tailer kept open per viewer. Agent id validated against `^[A-Za-z0-9]{6,64}$`; the folder comes from the server's resolved transcript path, the file must resolve inside it. |
| D10 | Nested agents | `spawnDepth` > 1 lists under its parent (the roster carries `parentAgentId` when derivable from the agent jsonl's own Agent calls; else by depth). First version shows depth 1 rows with a "+N nested" count; the sheet of a parent lists its children's rows. |
| D11 | Typing state | Client-only. Shown when `session.status === 'running'`, **no agent of the session is running**, and the last conversation row is a user prompt or a tool group with no pending step. Hidden on `waiting` (a permission question is not typing), on any pending tool step (its spinner says it), while any agent runs (the strip says what is happening), and on `idle`/`done`/`exited`. |
| D13 | Subagent hooks and session status | Hook signals whose `transcript_path` lies under a `subagents/` folder are **not** session status signals and never reach `setTranscript` (today `resolveTranscriptPath` would accept `…/subagents/agent-x.jsonl` and swap the usage meter onto the agent file). They may nudge the roster listing. The builder verifies whether Claude Code runs Argus's hooks inside subagents at all; if it does not, the guard costs nothing. |
| D14 | Status pill while agents run | **Decided: B.** A derived display state **Agents** shows on the status pill, the tile header, the mobile row and the Focus header while the roster has running agents and the session status is `idle`. `SessionStatus` is unchanged and the detector untouched: `SessionInfo` gains `agentsRunning: number` (kept by the server from the roster, broadcast with `session:agents`), and a client helper `displayStatus(session)` maps `idle + agentsRunning > 0` → `agents`. The **done** flow (notification, Waiting inbox, done badge) is deferred on the server while `agentsRunning > 0`: when the last agent finishes and the status is still `idle`, the done transition runs then. Sorting and filtering by status treat `agents` as `running`. |
| D12 | Copy | Writing guide: "agent", sentence case. Strip rows: `pre-push-reviewer · Delta review of fix commit · 33 s · 125k tokens · Reading handler.ts`. Typing row: "Claude is writing…". Chip: "2 agents". Sheet title: the description; subtitle the type. |

## Resolved: status while agents work

Chosen in conversation: **B**. While a Claude session has running agents and its own status is `idle`, every surface that shows the status shows **Agents** instead, and "done" waits for the agents. The detector, `SessionStatus` and the hooks pipeline are untouched; the derived state lives in `SessionInfo.agentsRunning` plus a client mapping (D14).

## Data model

```ts
// shared/src/types.ts
export type AgentRunStatus = 'running' | 'finished' | 'failed';

export interface AgentRun {
  /** Claude Code's agent id (the file name's `agent-<id>`). */
  id: string;
  /** The Agent tool_use that launched it, so the Chat can link the step to the row. */
  toolUseId?: string;
  agentType: string;        // "pre-push-reviewer", "general-purpose", "Explore"…
  description: string;      // the Agent call's description, clipped to 200
  background: boolean;      // meta.requestShape === 'background'
  depth: number;            // meta.spawnDepth, 1 for a direct child
  parentAgentId?: string;
  startedAt: number;        // epoch ms: first jsonl entry timestamp, else meta file birth time
  finishedAt?: number;      // epoch ms of the last jsonl entry once finished
  status: AgentRunStatus;
  outputTokens: number;     // sum of assistant message.usage.output_tokens so far
  /** Latest tool call of the agent, as a Chat tool step (label, status). */
  lastStep?: Pick<ChatToolBlock, 'name' | 'label' | 'status'>;
}

// SessionInfo
agentsRunning?: number;   // running agents of the roster; drives the derived Agents state (D14)

// ServerToClientEvents
'session:agents': (payload: { sessionId: string; agents: AgentRun[]; agentsRunning: number }) => void;

// REST
GET /api/sessions/:id/agents/:agentId/chat → { available: boolean; messages: ChatMessage[] }
```

`failed` = finished with the agent's last assistant entry absent or its final tool_result `is_error`, or the main transcript's task notification `<status>` not `completed`. Keep it simple: when in doubt, `finished`.

Caps: 20 agents per session in the broadcast (newest running first, then newest finished); `description` and `lastStep.label` 200 chars; the sheet reuses the Chat's `MAX_CHAT_MESSAGES` and tool input/output caps.

## Server

- `server/src/services/usage/AgentRoster.ts` (new): owns the `subagents/` folder of one transcript. `poll()` lists the folder (`agent-*.meta.json`), re-reads a meta file when its mtime changed, keeps one `JsonlTailer` per `agent-*.jsonl` and folds new entries into `startedAt`, `outputTokens`, `lastStep`, `finishedAt`. Returns the roster when anything changed. Uses the same `TranscriptFs` abstraction as the tailers so tests run on an in-memory fs.
- `SessionUsageTracker` creates the roster when `setTranscript` resolves a path (folder = path without `.jsonl`), polls it in its existing tick while the session is `running`/`waiting`, and reports changes through a callback `SessionManager` wires to `io.emit('session:agents', …)`. On `/clear` or resume (transcript path change) the roster is replaced.
- Fallback for D1: `ChatTail` already parses `<task-notification>` entries as foreign queued input. Expose the `(toolUseId, status)` pairs it sees; the roster marks a matching agent finished when its meta still says otherwise after the notification. For a non-background Agent call, its `tool_result` in the main transcript is the end.
- Route `server/src/routes/sessions.ts` (or a new `agents.ts` under the session router): the sheet endpoint. Reads `<folder>/agent-<id>.jsonl` fully through a throwaway `ChatTail`, returns its messages. Path containment: the folder comes from the server's own resolved transcript path, never from the request; the id is validated and the resolved file must stay inside the folder (`pathScope`-style check as for every fs route).
- `TranscriptTailer` (always on) learns to parse task notifications: a `queued_command` attachment or a plain user entry whose text starts with `<task-notification>`, yielding `(taskId, toolUseId, status)`; the roster consumes them. The notification can repeat for a resumed agent; a later `completed` after a `completed` is a no-op.
- `SessionManager` keeps `agentsRunning` on the session from the roster and includes it in `SessionInfo`. The idle→done transition (done notification, inbox) checks `agentsRunning`: while above zero it is deferred, and the roster's "last agent finished" callback re-runs the check.
- Keep the Electron/server rule: `import type` only from `@argus/shared`; any constant shared with the client is duplicated and registered in `scripts/check-dep-sync.mjs`.

## Client

- Store: `useSessions` keeps `agentsBySession: Record<string, AgentRun[]>` from `session:agents` (and a `GET /api/sessions` field `agents` on `SessionInfo` for the first paint, so a reload shows chips before the next broadcast).
- **Strip** `client/src/app/ui/chat/ChatAgentsStrip.tsx`: rendered by `ChatView` through the existing `aboveComposer` slot order (strip above prompt card, above composer). One row per depth-1 agent: icon (`Bot`), type, description (truncates first), elapsed (`useTick` 1 s), tokens, last step with the same `StatusMark` as tool steps. Finished rows fade out after 10 s. Tap → agent sheet. Touch target 44 px on the phone (`--row-h-touch`), hover changes background only (no reflow).
- **Derived status**: `client/src/utils/displayStatus.ts` maps `idle` + `agentsRunning > 0` → `agents`; `StatusPill` gains the `agents` variant (label "Agents", the running colour with the `Bot` glyph), used by the tile header, the mobile row, the Focus header and the minimized chip. Status-based sorting, filters and the Waiting inbox use the helper so `agents` sorts with `running`.
- **Chip**: `AgentsChip` beside `StatusPill` on the mobile row and in the desktop tile header; shows the running count; hidden at zero. Follows the header's shedding priority (desktop) so it never truncates the session name.
- **Agent sheet** `ChatAgentSheet.tsx`: desktop `Sheet` with title/subtitle, body = `ChatMessageItem` rows from the REST snapshot, refetched when the agent's roster entry changes while running; a `LoadingState` / `EmptyState` from `States.tsx`; errors through `toastError`. Phone: full-screen over Focus, same back affordance as the Diff screen. Opened from a strip row, and from an `Agent` tool step in the conversation (the step gains a small "Open" affordance when its `toolUseId` matches a roster entry; otherwise the step stays as today).
- **Typing row** in `ChatView`: a system-styled row "Claude is writing…" with the existing pending opacity, appended after the last row when D11 holds. Not a `ChatMessage`; never stored, never counted in `userCountOf`.
- Palette: no new command (no menu item, no setting), so `drift.test.ts` needs no entry. Copy goes through `copy.test.ts` rules.

## Mobile specifics

- The strip sits above the composer inside `.mobile-chat`; rows wrap description over tokens on narrow widths rather than truncating to nothing.
- The sheet is full-screen with the header pattern of `Diff.tsx` (back button, title), safe-area padded.
- No change to the terminal mode.

## Tests

- Server: `AgentRoster.test.ts` on an in-memory `TranscriptFs` with fixtures copied from a real `subagents/` folder (trimmed): start, incremental growth of tokens and last step, `finished` flip, meta mtime caching, fallback finish from a task notification, pre-2.1.301 agents never shown running, finished-at-first-sight agents read from meta only, `failed` on session exit/restart/transcript change, the 5 min "no output" label, cap at 20, nested depth, the `subagents/` guard on `setTranscript`. Route test: id validation, containment, missing file → `available: false`.
- Client: `displayStatus` mapping and the `agents` pill variant on every surface; done deferral on the server while agents run and its release when the last finishes; strip rendering per status; elapsed/tokens formatting; chip count and zero-hidden; typing row for each D11 case including `waiting`; sheet opens from a strip row and from a matching tool step; mobile Focus renders the strip in chat mode.
- `npm run verify` green; `check:deps` for any new constants.

## Left to the builder

- Backoff for a session with many unfinished pre-2.1.301 agents that will never flip (they are not polled: no timer when nothing counts as unfinished).
- Token formatting helper (reuse the usage meter's `k` formatting).
- Whether the strip collapses to one summary line past 4 agents, and the expand affordance for it.
- How a child agent's `parentAgentId` is derived when the jsonl does not name it (depth grouping is acceptable).

## Out of scope, recorded for later

- Streaming text (see Non-goals).
- Cost per agent in money.
- Stopping an agent from the strip. Claude Code has no per-agent stop other than Esc on the whole turn, which the composer's Stop already sends.
