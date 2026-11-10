# Agents in the Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a Claude session's running subagents in the Chat (a strip, a derived Agents status, a read-only agent sheet) and a typing row while a reply is pending, on desktop and phone.

**Architecture:** The server reads Claude Code's per-agent files (`<transcript-dir>/<conversationId>/subagents/agent-<id>.{meta.json,jsonl}`) through a new `AgentRoster` owned by `SessionUsageTracker`, broadcasts `session:agents`, carries `agentsRunning` on `SessionInfo`, and defers done promotion while agents run. The client derives an `agents` display status, renders a strip and chips from `SessionInfo.agents`, opens an agent's transcript through a byte-offset REST route, and shows a typing row from status alone.

**Tech Stack:** TypeScript ESM, Express + Socket.io (server, `node:test`), React 19 + Vite (client, Vitest + jsdom), `@xterm` untouched. Server and Electron code may only `import type` from `@argus/shared`.

**Spec:** `docs/superpowers/specs/2026-11-09-chat-agents-roster-design.md`

## Global Constraints

- Server and `electron/` code: `import type` only from `@argus/shared`; a value shared with the client is duplicated on the server and registered in `scripts/check-dep-sync.mjs` (check 3).
- `npm run verify` (lint → build:all incl. `check:deps` → test) is the commit gate; CI runs the same.
- An agent is **running** only when its meta file has no `finished` and its jsonl `version` is ≥ `2.1.301`; never from elapsed time (spec D1).
- Reads are incremental: one `JsonlTailer` per unfinished agent; finished-at-first-sight agents are read from meta only (D4).
- Roster broadcast cap: 20 agents per session; `description` and `lastStep.label` clipped to 200 chars.
- Copy: writing guide (`docs/design/writing-guide.md`): sentence case, the noun "agent"; pill label `AGENTS` (uppercase mono like the others); strip row `type · description · 33 s · 125k tokens · <last step>`; typing row "Claude is writing…"; chip "N agents"; stale row "no output for N min" after 5 min without a jsonl write.
- Hover changes background only, never row size (project rule). Touch targets on the phone: `var(--row-h-touch)` (44px).
- ESLint `argus/no-raw-style-scale`: no raw px/font/radius literals in style objects; use tokens.
- Agent id regex for the route: `^[A-Za-z0-9][A-Za-z0-9-]{5,95}$` (named agents carry hyphens); the agent file must resolve inside the session's own transcript folder.
- Status detector, `SessionStatus` and the hooks pipeline stay unchanged (D14).

## Review Focus

1. A `subagents/` folder that does not exist yet, or a meta file that is malformed JSON or half-written: the roster must skip it silently and try again next tick, never throw out of `poll()`. (Task 4 test "malformed meta is skipped".)
2. A hook from inside a subagent reporting `transcript_path=…/subagents/agent-x.jsonl`: must not become the session's transcript nor move its status. (Task 7 test.)
3. An agent id in the URL with path characters (`../`, `%2e`, a slash) or an id that matches the regex but names no file: 400 / 404, never a read outside the folder. (Task 6 route tests.)
4. A session that exits or is restarted with agents running, or whose transcript changes (`/clear`, resume): every running agent flips to `failed` and `agentsRunning` goes to 0 so done promotion is not held forever. (Task 6 test "exit fails the roster".)
5. A meta file rewritten within the same mtime tick (fast `finished` flip right after launch): the roster must re-read when size changed too, not only mtime. (Task 4 test "finished within the same mtime".)

---

### Task 1: Shared types

**Files:**
- Modify: `shared/src/types.ts` (SessionInfo ~line 452–520; ServerToClientEvents ~line 1364–1375; after the Chat types ~line 1060)

**Interfaces:**
- Produces:
  ```ts
  export type AgentRunStatus = 'running' | 'finished' | 'failed';
  export interface AgentRun {
    id: string; toolUseId?: string; agentType: string; description: string;
    background: boolean; depth: number; parentAgentId?: string;
    startedAt: number; finishedAt?: number; status: AgentRunStatus;
    outputTokens: number; lastStep?: Pick<ChatToolBlock, 'name' | 'label' | 'status'>;
    /** Set while running and the jsonl has not grown for 5 min: minutes since its last write. */
    quietMinutes?: number;
  }
  export interface AgentChatResponse { available: boolean; messages: ChatMessage[]; offset: number }
  // SessionInfo additions
  agents?: AgentRun[]; agentsRunning?: number;
  // ServerToClientEvents addition
  'session:agents': (payload: { sessionId: string; agents: AgentRun[]; agentsRunning: number }) => void;
  ```

- [ ] **Step 1: Add the types above** with doc comments in the spec's words (D1, D5, D14). Put `AgentRun`/`AgentRunStatus`/`AgentChatResponse` next to `ChatUpdate`.

- [ ] **Step 2: Build shared and typecheck everything**

Run: `npm run build -w shared && npx tsc -p server --noEmit && npx tsc -p client --noEmit`
Expected: no errors (the fields are optional, nothing consumes them yet).

- [ ] **Step 3: Commit**

```bash
git add shared/src/types.ts
git commit -m "feat(shared): AgentRun roster types and session:agents event"
```

---

### Task 2: `TranscriptFs` gains `readdir` and `mtimeMs`

**Files:**
- Modify: `server/src/services/usage/JsonlTailer.ts:16-36`
- Test: `server/src/services/usage/JsonlTailer.test.ts` (create if absent)

**Interfaces:**
- Produces:
  ```ts
  export interface TranscriptFs {
    stat(path: string): Promise<{ size: number; ino: number; mtimeMs: number }>;
    read(path: string, position: number, length: number): Promise<Buffer>;
    readdir(dir: string): Promise<string[]>;   // names only; [] when the dir is missing
    readFile(path: string): Promise<string>;   // utf8; small files (meta.json)
  }
  ```
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** `nodeTranscriptFs lists a dir, returns [] for a missing dir, and stat carries mtimeMs` using a `mkdtempSync` dir: write two files, assert `readdir` returns both names sorted by the test, `readdir(path.join(d, 'nope'))` resolves `[]`, `stat(file).mtimeMs > 0`, `readFile` returns the content.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w server -- --test-name-pattern="nodeTranscriptFs"`
Expected: FAIL, `readdir is not a function`.

- [ ] **Step 3: Implement** the two methods and the `mtimeMs` field in `nodeTranscriptFs`; `readdir` catches `ENOENT`/`ENOTDIR` → `[]`. Fix every existing fake `TranscriptFs` in tests (grep `stat(path)` in `server/src/services/usage/*.test.ts`) to carry `mtimeMs: 0` and the two methods.

- [ ] **Step 4: Run the usage suite**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/usage/JsonlTailer.ts server/src/services/usage/*.test.ts
git commit -m "feat(usage): TranscriptFs readdir, readFile and mtime for the agent roster"
```

---

### Task 3: Task notifications from the main transcript

**Files:**
- Modify: `server/src/services/usage/TranscriptTailer.ts:143-150` (prefilter), new private method
- Test: `server/src/services/usage/TranscriptTailer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TaskNotification { taskId: string; toolUseId?: string; status: string; at: number }
  // on TranscriptTailer
  /** Notifications seen since the last call; cleared on return. */
  takeTaskNotifications(): TaskNotification[];
  ```
- Consumes: `JsonlTailer.line(text)`.

- [ ] **Step 1: Write the failing test** `takeTaskNotifications yields the id, tool-use id and status of a task notification, from a plain user entry and from a queued_command attachment, once`:
  - line A: a `user` entry whose `message.content` is the string `<task-notification>\n<task-id>abc123</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n…` with `timestamp` `2026-11-09T07:52:19.623Z`.
  - line B: an entry with `attachment.type === 'queued_command'` whose `attachment.prompt` carries the same tags with task-id `def456`, status `failed`, no tool-use-id.
  - assert `takeTaskNotifications()` → `[{taskId:'abc123', toolUseId:'toolu_1', status:'completed', at: Date.parse(...)}, {taskId:'def456', status:'failed', at: …}]`, then a second call → `[]`.
  - assert `poll()` returned `false` for these lines (they are not usage changes).

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w server -- --test-name-pattern="takeTaskNotifications"`
Expected: FAIL, method missing.

- [ ] **Step 3: Implement**: in `line()`, before the usage prefilter, `if (text.includes('<task-notification>')) this.noteTask(text);` where `noteTask` parses the JSON, finds the text in `message.content` (string, or the first text part) or `attachment.prompt`, extracts `<task-id>`, `<tool-use-id>`, `<status>` with anchored regexes, pushes to a private array capped at 50, and returns (the line still falls through to the usage check, which rejects it). `takeTaskNotifications()` returns and clears the array.

- [ ] **Step 4: Run the tailer suite**

Run: `npm test -w server -- --test-name-pattern="TranscriptTailer"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/usage/TranscriptTailer.ts server/src/services/usage/TranscriptTailer.test.ts
git commit -m "feat(usage): parse task notifications from the transcript"
```

---

### Task 4: `AgentRoster`

**Files:**
- Create: `server/src/services/usage/AgentRoster.ts`
- Create: `server/src/services/usage/AgentRoster.test.ts`
- Create: `server/src/services/usage/fixtures/subagents/` with two trimmed real files: `agent-aaaaaaaaaaaaaaaaa.meta.json` (finished: absent, `requestShape: "background"`, `toolUseId: "toolu_1"`, `spawnDepth: 1`, `agentType: "pre-push-reviewer"`, `description: "Delta review of fix commit"`) and `agent-aaaaaaaaaaaaaaaaa.jsonl` (≤ 12 lines: a user prompt, two assistant entries with `message.usage.output_tokens` 167 and 249 and a `tool_use` named `Bash` with `description: "Run tests"`, one tool_result, all with `version: "2.1.319"`, `agentId`, `isSidechain: true`, timestamps 1 s apart). Copy from `~/.claude/projects/-Users-macbookpro10-development-projects-argus/cca3e192-…/subagents/` and trim; strip any path or prompt text not needed.

**Interfaces:**
- Produces:
  ```ts
  export const AGENT_FINISHED_FLAG_MIN_VERSION = '2.1.301';
  export const AGENT_QUIET_MS = 5 * 60_000;
  export const AGENT_ROSTER_CAP = 20;
  export interface AgentRosterOpts { fs?: TranscriptFs; now?: () => number }
  export class AgentRoster {
    constructor(folder: string, opts?: AgentRosterOpts);
    /** List + stat metas, tail unfinished agents. True when the broadcast list changed. */
    poll(): Promise<boolean>;
    /** Newest running first, then newest finished; capped at AGENT_ROSTER_CAP. */
    agents(): AgentRun[];
    runningCount(): number;
    /** D1 fallback: a task notification ends the matching agent. True when one changed. */
    applyNotification(n: TaskNotification): boolean;
    /** Exit / restart / transcript change: every running agent → failed. True when any changed. */
    failAll(): boolean;
    dispose(): void;
  }
  ```
- Consumes: `TranscriptFs` (Task 2), `TaskNotification` (Task 3), `toolBlockOf`/`toolResultsOf`/`withResult` from `chatTools.ts`, `JsonlTailer`.

- [ ] **Step 1: Write the failing tests** in `AgentRoster.test.ts`, each on a `mkdtempSync` folder with the fixtures copied in (real `nodeTranscriptFs`, `now` injected):
  - `lists a running agent from its meta and tails its jsonl`: after `poll()`, `agents()[0]` has `id`, `agentType`, `description`, `toolUseId:'toolu_1'`, `background:true`, `depth:1`, `status:'running'`, `outputTokens: 416`, `startedAt` = first entry timestamp, `lastStep: {name:'Bash', label:'Run tests', status:'ok'}`; `runningCount()` is 1.
  - `an agent already finished at first sight is listed from meta only`: meta with `finished: true` → `status:'finished'`, `outputTokens: 0`, no `lastStep`, and `poll()` never reads its jsonl (assert with a `TranscriptFs` wrapper that counts `read` calls per path).
  - `a pre-2.1.301 agent without the flag is never running`: jsonl `version: "2.1.299"` → `status:'finished'`.
  - `finished flips when the meta gains the flag`: append-free rewrite of the meta with `finished: true` → `status:'finished'`, `finishedAt` = last entry timestamp, `runningCount()` 0, `poll()` returned true.
  - `finished within the same mtime`: rewrite the meta with `finished: true` and force the same `mtimeMs` through a wrapping fs that returns a constant `mtimeMs` but the real `size` → still detected.
  - `malformed meta is skipped`: write `{` as a meta → `poll()` resolves (no throw), the agent is absent; fix the file → present on the next poll.
  - `a task notification ends an agent`: running agent; `applyNotification({taskId:'aaaaaaaaaaaaaaaaa', status:'completed', at})` → `finished`; status `'failed'` in the notification → `failed`; an unknown id → returns false.
  - `failAll marks running agents failed`.
  - `quiet rows say so`: `now` jumps 6 min past the last jsonl write → `quietMinutes: 6`; a new line clears it.
  - `cap and order`: 25 metas, 3 running → `agents().length === 20`, running first, newest first within each group.
  - `nested agents carry parentAgentId`: meta with `spawnDepth: 2, parentAgentId: 'aaaaaaaaaaaaaaaaa'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w server -- --test-name-pattern="AgentRoster"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `AgentRoster`**. Per `poll()`: `readdir(folder)` → meta names matching `/^agent-([A-Za-z0-9]{6,64})\.meta\.json$/`; for each, `stat` and re-`readFile` when `mtimeMs` or `size` differs from the cached pair; parse with try/catch; derive `startedAt` from the first jsonl entry timestamp (fallback: meta `mtimeMs` at first sight). A running agent gets an inner `class AgentTail extends JsonlTailer` that folds assistant `usage.output_tokens`, the latest `tool_use` into `lastStep` via `toolBlockOf`, results via `toolResultsOf`/`withResult`, the max `version` seen, and the last entry timestamp. Running requires: no `finished`, `version >= AGENT_FINISHED_FLAG_MIN_VERSION` (compare as three numbers; unknown version counts as old). `status` resolution order per D1. Hash the broadcast list (`JSON.stringify` of `agents()`) to decide the boolean.

- [ ] **Step 4: Run the tests**

Run: `npm test -w server -- --test-name-pattern="AgentRoster"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/usage/AgentRoster.ts server/src/services/usage/AgentRoster.test.ts server/src/services/usage/fixtures
git commit -m "feat(usage): AgentRoster reads Claude Code's subagent files incrementally"
```

---

### Task 5: Roster inside `SessionUsageTracker`

**Files:**
- Modify: `server/src/services/usage/SessionUsageTracker.ts` (ctor opts ~line 26-40; `setTranscript` 201-216; `pollNow` 267-287; `dispose`)
- Test: `server/src/services/usage/SessionUsageTracker.agents.test.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  // SessionUsageTrackerOpts additions
  onAgents?: (agents: AgentRun[], running: number) => void;
  agentsPollMs?: number;            // default 1000
  // methods
  agentsSnapshot(): { agents: AgentRun[]; running: number };
  failAgents(): void;               // exit / restart: forwards to the roster, emits once
  ```
- Consumes: `AgentRoster` (Task 4), `takeTaskNotifications()` (Task 3).

- [ ] **Step 1: Write the failing tests**, `setup()` as in `SessionUsageTracker.chat.test.ts` (temp dir as root, `agentsPollMs: 60_000` so tests drive reads with `pollNow()`):
  - `setTranscript creates the roster next to the transcript and reports agents on pollNow`: transcript `d/conv.jsonl`, fixtures in `d/conv/subagents/` → after `pollNow()` the `onAgents` callback got the running agent and `running === 1`; `agentsSnapshot()` matches.
  - `the roster timer runs only while an agent is unfinished`: with `agentsPollMs: 20`, a running agent → `onAgents` fires again after the meta flips to finished; then no further calls within 100 ms once nothing is unfinished (count stable).
  - `a task notification in the transcript ends the agent`: append the notification line to `conv.jsonl`, `pollNow()` → `status:'finished'`.
  - `a transcript change fails the old roster`: `setTranscript(d/other.jsonl)` → the previous running agent reported as `failed` once, then the new roster (empty) reported.
  - `a subagent transcript path is refused`: `setTranscript(d/conv/subagents/agent-x.jsonl)` → `currentTranscript()` unchanged (D13).
  - `failAgents emits failed and running 0`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w server -- --test-name-pattern="SessionUsageTracker.agents|roster"`
Expected: FAIL.

- [ ] **Step 3: Implement**: in `setTranscript`, refuse paths whose dirname basename is `subagents`; create `new AgentRoster(p.slice(0, -'.jsonl'.length), { fs })` per transcript (map keyed by path, same cap as tailers); in `pollNow`, after the transcript poll, drain `tailer.takeTaskNotifications()` into `roster.applyNotification`, then `roster.poll()`, and emit `onAgents` when either changed; keep an `agentsTimer` (`setInterval(agentsPollMs)`) alive only while `roster.runningCount() > 0`, cleared otherwise and in `dispose()`.

- [ ] **Step 4: Run the suite**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/usage/SessionUsageTracker.ts server/src/services/usage/SessionUsageTracker.agents.test.ts
git commit -m "feat(usage): the usage tracker owns the agent roster and drives its poll"
```

---

### Task 6: `SessionManager`: broadcast, `SessionInfo`, done deferral, agent chat route

**Files:**
- Modify: `server/src/services/SessionManager.ts` (`usageTracker()` ~2427; `toSessionInfo` ~3372; `tryPromoteDone` ~2055; heuristic done ~1908; native done ~2215; exit/restart paths that call `nudgeUsage(session, true)` ~1602, 1850; `applyAgentMeta` 2253)
- Modify: `server/src/routes/sessions.ts` (after `/:id/conversations` ~line 88)
- Modify: `server/src/services/SessionManager.ts` → add `agentChat(id, agentId, after)` used by the route
- Test: `server/src/routes/sessions.agents.test.ts` (new, harness as `activity.test.ts`), `server/src/services/SessionManager.agents.test.ts` (new; mirror an existing SessionManager unit test's construction, grep `new SessionManager(` in `server/src/services/*.test.ts`)

**Interfaces:**
- Produces:
  ```ts
  // SessionManager
  agentChat(id: string, agentId: string, after: number): Promise<AgentChatResponse | undefined>; // undefined: unknown session or agent
  private retryDonePromotion(id: string): void;  // called by the roster callback when running hits 0
  // route
  GET /api/sessions/:id/agents/:agentId/chat?after=<int>  → AgentChatResponse | 400 (bad id/after) | 404
  ```
- Consumes: Task 5 (`onAgents`, `agentsSnapshot`, `failAgents`), `ChatTail` (read an agent jsonl from `after` to EOF: construct `new ChatTail(path, fs)`, set its offset to `after` through a small protected setter added to `JsonlTailer`: `seek(offset: number)`), `resolveWithinBase` from `utils/pathScope`.

- [ ] **Step 1: Write the failing route tests** (`sessions.agents.test.ts`) against a fake `manager` exposing only `agentChat`:
  - `200 with messages and the new offset` for id `aaaaaaaaaaaaaaaaa`, `after=0` → body `{available:true, messages:[…], offset:N}`; `after=N` → `messages: []`, same offset.
  - `400 for an agent id with a slash, a dot, or over 64 chars; 400 for a non-integer after`.
  - `404 for an unknown session or agent`.

- [ ] **Step 2: Write the failing manager tests** (`SessionManager.agents.test.ts`):
  - `session:agents is emitted with the roster and running count, and SessionInfo carries both`.
  - `done promotion waits for agents`: session `running`, native idle arrives while `agentsRunning === 1` → status stays `idle`, no `done`; roster reports running 0 → `done` emitted (grace timer honoured: use the existing fake timers pattern of the done tests, grep `DONE_GRACE_MS` in tests).
  - `exit fails the roster`: a running agent on a session that exits → `session:agents` with `status:'failed'`, `agentsRunning 0`.
  - `agentChat refuses a file outside the folder` (an id that resolves through a symlink elsewhere) and `undefined` for a missing agent.

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test -w server -- --test-name-pattern="agents"`
Expected: FAIL.

- [ ] **Step 4: Implement**: `usageTracker()` passes `onAgents: (agents, running) => this.onAgentsChange(session, agents, running)`, which stores `session.agents = agents; session.agentsRunning = running`, emits `session:agents`, and calls `retryDonePromotion` when running dropped to 0. `toSessionInfo` adds `agents`, `agentsRunning`. Add one gate `agentsHold(session) = (session.agentsRunning ?? 0) > 0` checked in `tryPromoteDone` (re-arm the grace instead of promoting) and in both idle→done paths (treat as plain `idle`). `retryDonePromotion`: if status is `idle`, not suppressed, `hasUserInputSinceIdle`, and the last status before idle was running → `armDoneGrace`. Exit and restart paths call `session.usage?.failAgents()`. `agentChat`: validate id, `resolveWithinBase(folder, 'agent-<id>.jsonl')`, read with a `ChatTail` seeked to `after`, return `{available, messages, offset}`. Route as in `/:id/conversations`.

- [ ] **Step 5: Run the server suite**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/SessionManager.ts server/src/routes/sessions.ts server/src/services/usage/JsonlTailer.ts server/src/routes/sessions.agents.test.ts server/src/services/SessionManager.agents.test.ts
git commit -m "feat(server): session:agents broadcast, done waits for agents, agent chat route"
```

---

### Task 7: Subagent hooks never drive the session (D13)

**Files:**
- Modify: `server/src/routes/agentSignals.ts:150-170`
- Test: `server/src/routes/agentSignals.test.ts`

**Interfaces:**
- Produces: `export function isSubagentTranscript(p: string): boolean` in `server/src/services/usage/SessionUsageTracker.ts` (basename of dirname === `subagents`), reused by Task 5's guard.

- [ ] **Step 1: Write the failing test** `a hook whose transcript_path is a subagent file neither sets the transcript nor moves the status`: POST the hook payload with `transcriptPath: '/…/conv/subagents/agent-x.jsonl'` and a `running` signal → the fake manager's `applyAgentMeta` not called with that path and its signal handler not called; the response is still 204.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w server -- --test-name-pattern="subagent file"`
Expected: FAIL.

- [ ] **Step 3: Implement**: in the route, when `isSubagentTranscript(transcriptPath)`, skip both `applyAgentMeta` and the state signal, and call `manager.nudgeAgents(sessionId)` (new one-liner: `session.usage?.schedule()` so the roster lists the new agent sooner).

- [ ] **Step 4: Run the suite**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/agentSignals.ts server/src/routes/agentSignals.test.ts server/src/services/usage/SessionUsageTracker.ts server/src/services/SessionManager.ts
git commit -m "fix(hooks): a subagent's hook nudges the roster, never the session"
```

---

### Task 8: Derived `agents` status on every pill

**Files:**
- Create: `client/src/utils/displayStatus.ts`, `client/src/utils/displayStatus.test.ts`
- Modify: `client/src/constants/status.ts` (all four records), `client/src/components/primitives/StatusPill.tsx`, `client/src/components/primitives/StatusDot.tsx`, `client/src/index.css:685-689`
- Modify call sites to pass `displayStatus(session)`: `client/src/app/mobile/Sessions.tsx:222`, `client/src/app/mobile/FocusHeader.tsx:63`, `client/src/app/views/Focus.tsx:340`, `client/src/app/ui/ModalPlaceholder.tsx:26`, `client/src/app/overlays/SessionPickerSheet.tsx:51`, `client/src/app/overlays/CommandPalette.tsx:700`, `client/src/app/overlays/BroadcastSheet.tsx:138`, the Mosaic tile header's status dot/label (grep `status={session.status}` in `client/src/app/views/Mosaic.tsx` and `client/src/app/ui/MinimizedChip.tsx`).

**Interfaces:**
- Produces:
  ```ts
  export type DisplayStatus = SessionStatus | 'agents';
  export function displayStatus(s: Pick<SessionInfo, 'status' | 'agentsRunning'>): DisplayStatus; // idle + agentsRunning>0 → 'agents'
  export function sortStatus(s: DisplayStatus): SessionStatus;                                   // 'agents' → 'running', else identity
  ```
  `StatusPill`/`StatusDot` accept `DisplayStatus`; `STATUS_LABELS.agents = 'AGENTS'`, `STATUS_COLORS.agents = 'var(--status-running)'`, pulse false, marquee true.

- [ ] **Step 1: Write the failing tests** (`displayStatus.test.ts`): `idle with 2 running agents → 'agents'`, `idle with 0 → 'idle'`, `running with agents → 'running'`, `waiting with agents → 'waiting'`, `sortStatus('agents') === 'running'`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w client -- displayStatus`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement** the helper and the constants; add `.argus-status[data-status="agents"] { --st-color: var(--status-running); --st-bg: var(--status-running-bg); }` next to line 686; widen the pill/dot prop types; update every call site listed above; wherever sessions are sorted or filtered by status (`grep -rn "status === 'running'\|=== 'idle'" client/src/app client/src/hooks`, the Mosaic order and the Sessions list groups) feed `sortStatus(displayStatus(s))` so an `agents` session sorts and filters with `running` (D14); the Waiting inbox and notifications keep `session.status`, the detector's truth.

- [ ] **Step 4: Run client tests and lint**

Run: `npm test -w client && npm run lint -w client`
Expected: PASS (copy.test, drift.test untouched: no new menu item or setting).

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/displayStatus.ts client/src/utils/displayStatus.test.ts client/src/constants/status.ts client/src/components/primitives/StatusPill.tsx client/src/components/primitives/StatusDot.tsx client/src/index.css client/src/app
git commit -m "feat(status): Agents display state while a session's helpers run"
```

---

### Task 9: Client store and chip

**Files:**
- Modify: `client/src/hooks/useSessions.ts:195-220`
- Create: `client/src/app/ui/AgentsChip.tsx`, `client/src/app/ui/AgentsChip.test.tsx`
- Modify: `client/src/app/mobile/Sessions.tsx:210-213` (chips row), `client/src/app/views/Mosaic.tsx:914-933` (tile header, under `showPills`), `client/src/app/views/Focus.tsx` desktop header next to `StaleChip`, `client/src/app/mobile/FocusHeader.tsx` next to the pill.

**Interfaces:**
- Produces: `useSessions` applies `session:agents` → `{ ...s, agents, agentsRunning }`; `export function AgentsChip({ count, onClick? }: { count: number; onClick?: () => void })` renders nothing at 0, else a pill-sized chip "N agents" (`N agent` at 1) with the `Bot` icon, `title="Running agents"`.

- [ ] **Step 1: Write the failing tests** (`AgentsChip.test.tsx`): `renders nothing for 0`, `"1 agent" and "3 agents"`, `calls onClick`. In `useSessions` test (grep an existing `session:usage` test in `client/src/hooks/useSessions.test.ts` and mirror it): `session:agents updates agents and agentsRunning`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w client -- AgentsChip useSessions`
Expected: FAIL.

- [ ] **Step 3: Implement** the handler (same shape as `handleUsage`), the chip (tokens only: `var(--t-tiny)`, `var(--s-1)` gaps, `Row`), and place it on the four surfaces; on the desktop tile header it sheds with `showPills`.

- [ ] **Step 4: Run client tests and lint**

Run: `npm test -w client && npm run lint -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/hooks/useSessions.ts client/src/app/ui/AgentsChip.tsx client/src/app/ui/AgentsChip.test.tsx client/src/app/mobile/Sessions.tsx client/src/app/mobile/FocusHeader.tsx client/src/app/views/Mosaic.tsx client/src/app/views/Focus.tsx
git commit -m "feat(ui): agents count chip on session rows and headers"
```

---

### Task 10: Agents strip in the Chat

**Files:**
- Create: `client/src/app/ui/chat/ChatAgentsStrip.tsx`, `client/src/app/ui/chat/ChatAgentsStrip.test.tsx`, `client/src/hooks/useNow.ts`
- Modify: `client/src/app/ui/chat/ChatView.tsx:470` (render the strip before `{aboveComposer}`), `client/src/index.css` (strip styles after `.argus-chat-prompt-wrap`, phone overrides in the `.mobile-chat` block)

**Interfaces:**
- Produces:
  ```ts
  export function useNow(intervalMs: number): number;            // ticking Date.now()
  export function ChatAgentsStrip({ agents, onOpen }: { agents: AgentRun[]; onOpen: (agent: AgentRun) => void }): JSX.Element | null;
  export function agentRowText(a: AgentRun, now: number): string; // "pre-push-reviewer · Delta review of fix commit · 33 s · 125k tokens · Reading handler.ts" / "… · no output for 6 min"
  ```
- Consumes: `formatTokens` (`client/src/utils/usageFormat.ts:95`), `StatusMark`-equivalent icons from `ChatToolGroup.tsx` (export `StatusMark` from there), `AgentRun` (Task 1).

- [ ] **Step 1: Write the failing tests**:
  - `agentRowText` for a running agent 33 s old with 125,000 tokens and `lastStep {name:'Read', label:'handler.ts', status:'ok'}` → exact string above; `quietMinutes: 6` → ends with `no output for 6 min`; a finished one shows no elapsed tick (uses `finishedAt - startedAt`).
  - strip: `renders depth-1 rows only, with "+N nested" on the parent`; `a row that finishes stays 10 s then leaves` (fake timers); `returns null with no agents`; `tap calls onOpen with the agent`.
  - ChatView: `shows the strip when the session has agents` (session prop with `agents: [running]`).

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w client -- ChatAgentsStrip ChatView`
Expected: FAIL.

- [ ] **Step 3: Implement**: rows are `<button>`s (44px min height on `.mobile-chat`, `var(--row-h)` elsewhere), hover = background only; `useNow(1000)` only while any row is running; the 10 s linger via a local `Set` of ids with timestamps; CSS classes `argus-chat-agents`, `argus-chat-agent-row`, `argus-chat-agent-meta`.

- [ ] **Step 4: Run client tests and lint**

Run: `npm test -w client && npm run lint -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/ui/chat/ChatAgentsStrip.tsx client/src/app/ui/chat/ChatAgentsStrip.test.tsx client/src/hooks/useNow.ts client/src/app/ui/chat/ChatView.tsx client/src/app/ui/chat/ChatToolGroup.tsx client/src/index.css
git commit -m "feat(chat): running agents strip above the composer"
```

---

### Task 11: Typing row

**Files:**
- Create: `client/src/app/ui/chat/typingRow.ts`, `client/src/app/ui/chat/typingRow.test.ts`
- Modify: `client/src/app/ui/chat/ChatView.tsx` (after the virtualized list, inside `.argus-chat-main`), `client/src/index.css` (`.argus-chat-typing`)

**Interfaces:**
- Produces: `export function showTypingRow(status: SessionStatus, agentsRunning: number, lastRow: ChatMessage | undefined): boolean` implementing D11 exactly; the row text is `Claude is writing…`.

- [ ] **Step 1: Write the failing tests** (`typingRow.test.ts`): true for `running, 0, user prompt`; true for `running, 0, tool group all ok`; false for `running, 0, tool group with a pending step`; false for `running, 1, user prompt`; false for `waiting`, `idle`, `done`, `exited`; false with no rows.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w client -- typingRow`
Expected: FAIL.

- [ ] **Step 3: Implement** the predicate and render `<div className="argus-chat-typing" data-testid="chat-typing">Claude is writing…</div>` with the `.argus-chat-msg.is-pending` opacity and a reduced-motion-safe pulse (`@media (prefers-reduced-motion: reduce)` disables it). Add a ChatView test `typing row appears for a running session with a recorded prompt and no agents`.

- [ ] **Step 4: Run client tests, lint, copy test**

Run: `npm test -w client && npm run lint -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/app/ui/chat/typingRow.ts client/src/app/ui/chat/typingRow.test.ts client/src/app/ui/chat/ChatView.tsx client/src/index.css
git commit -m "feat(chat): typing row while a reply is pending"
```

---

### Task 12: Agent sheet (desktop and phone)

**Files:**
- Modify: `client/src/services/api.ts:242` (add `getAgentChat`)
- Create: `client/src/app/ui/chat/ChatAgentSheet.tsx`, `client/src/app/ui/chat/ChatAgentSheet.test.tsx`, `client/src/hooks/useAgentChat.ts`
- Modify: `client/src/app/ui/chat/ChatView.tsx` (open from the strip; `Agent` tool steps whose `id` matches a roster `toolUseId` get an "Open" affordance in `ChatToolGroup.tsx` `Step`), `client/src/app/mobile/Focus.tsx` (full-screen host like `showChanges`), `client/src/index.css`

**Interfaces:**
- Produces:
  ```ts
  // api
  getAgentChat(sessionId: string, agentId: string, after: number): Promise<AgentChatResponse>;
  // hook
  export function useAgentChat(sessionId: string, agent: AgentRun | null): { messages: ChatMessage[]; loading: boolean; error: unknown };
  // component
  export function ChatAgentSheet({ session, agent, onClose, fullScreen }: { session: SessionInfo; agent: AgentRun; onClose: () => void; fullScreen?: boolean }): JSX.Element;
  ```
- Consumes: Task 6 route, Task 10 strip `onOpen`, `Sheet` primitive (`client/src/components/primitives/Sheet.tsx`), `ChatMessageItem`, `chatRows`, `LoadingState`/`EmptyState`/`ErrorState`, `toastError`.

- [ ] **Step 1: Write the failing tests**:
  - `useAgentChat` (mock `api.getAgentChat`): first call with `after 0`, appends by id on the next roster change with the returned offset, stops refetching once the agent is not running.
  - sheet: `title is the description, subtitle the type`, `renders messages and tool steps`, `no composer`, `error state goes through describeError` (assert an `ErrorState`, not raw text).
  - ChatView: `strip row opens the sheet`; `an Agent step with a roster match offers Open`.
  - mobile Focus: `the sheet renders full screen over the chat`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test -w client -- ChatAgentSheet useAgentChat ChatView Focus`
Expected: FAIL.

- [ ] **Step 3: Implement**. Desktop: `Sheet` with `width` 560 token-sized; phone: `fullScreen` renders the `Diff.tsx` header pattern (back button, title) in a `position: fixed; inset: 0` host, safe-area padded. Nested agents: children rows from `session.agents` filtered by `parentAgentId` under the header. The refetch trigger is the agent's roster entry identity (`outputTokens`, `lastStep`, `status`).

- [ ] **Step 4: Run client tests and lint**

Run: `npm test -w client && npm run lint -w client`
Expected: PASS (`noRawErrorToasts.test`, `feedbackSurfaces.test` included).

- [ ] **Step 5: Commit**

```bash
git add client/src/services/api.ts client/src/app/ui/chat/ChatAgentSheet.tsx client/src/app/ui/chat/ChatAgentSheet.test.tsx client/src/hooks/useAgentChat.ts client/src/app/ui/chat/ChatView.tsx client/src/app/ui/chat/ChatToolGroup.tsx client/src/app/mobile/Focus.tsx client/src/index.css
git commit -m "feat(chat): open an agent to read what it is doing"
```

---

### Task 13: Docs and the full gate

**Files:**
- Modify: `site/features/mobile.md` (one bullet: agents strip, Agents status, open an agent), the desktop Chat feature page under `site/features/` (grep "Chat" to find it), `CLAUDE.md` (server architecture: one line for `AgentRoster` under `services/`), `docs/superpowers/specs/2026-11-09-chat-agents-roster-design.md` status line → "built in <version>".

- [ ] **Step 1: Write the docs** in the writing guide's voice.

- [ ] **Step 2: Run the whole gate**

Run: `npm run verify`
Expected: exit 0 (`check:deps` includes `check-docs-links`).

- [ ] **Step 3: Live check** with `npm run dev`: start a Claude session, ask it to run two background agents; confirm the pill reads AGENTS while idle, the strip lists both with ticking elapsed, the chip shows "2 agents" on the list, an agent opens and its steps grow, the typing row shows after a plain prompt and not while agents run, and done arrives once the agents finish. Repeat the strip and sheet on `/mobile` at phone width.

- [ ] **Step 4: Commit**

```bash
git add site CLAUDE.md docs/superpowers/specs/2026-11-09-chat-agents-roster-design.md
git commit -m "docs: agents in the chat"
```
