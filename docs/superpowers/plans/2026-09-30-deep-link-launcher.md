# Deep-link launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Argus accepts `argus://new?…` links, which always open an approval card, and `argus://run/<id>` links for launchers the user saved from an approved card. Both start an agent tile with an optional initial prompt.

**Architecture:**
- A pure URL parser and a pure approval gate live in `electron/src/`, wired into the existing `open-url` handler.
- Validation, the launcher store and session creation live in the server, which Electron main imports in-process. There are no new REST routes.
- The renderer shows pending launches through a new preload bridge (`electronLaunch`), and manages launchers in a new Settings pane.

**Tech Stack:** Electron 42, TypeScript strict ESM, Node `node:test` (server + electron), React 19 + Vitest/jsdom (client).

**Spec:** `docs/superpowers/specs/2026-09-30-deep-link-launcher-design.md`. Read it before starting.

## Global Constraints

- Server and `electron/` code may only `import type` from `@argus/shared`. A value import crashes the packaged app (CLAUDE.md). All new shared additions are types, except the `DEFAULT_CONFIG` literal, which is duplicated in `server/src/persistence/ConfigStore.ts`.
- `npm run verify` is the gate before every commit (lint → build:all incl. `check:deps` → test).
- Link limits:
  - URL ≤ 8192 chars
  - prompt ≤ 4096 chars
  - double-quoted tmux form ≤ 12288 bytes
  - ≤ 5 pending launches
  - pending expiry 10 min
  - burst limit 3 links / 10 s
  - error toasts ≤ 1 / 10 s
  - Start delay 1000 ms
- Launcher id: `^[a-z0-9-]{1,40}$`. A `run/<id>` link takes no query params.
- Prompt: first non-whitespace char must not be `-`; no control chars except `\n`; no Unicode format chars (`\p{Cf}`). Name and folder: no control or format chars at all.
- A prompt is appended **after** signal injection, is passed **only** on a fresh launch, and is **never** persisted.
- There is no dangerous-flag classification. The card shows every argument on its own row.
- Folder warnings (never blocking):
  - outside `config.launchFolderRoots` (default `['~/development']`)
  - contains `.claude/`, `.mcp.json` or `CLAUDE.md`
- Approval and launcher writes happen only over IPC from a focused Argus window's main frame. There is no REST route.
- Dev scheme `argus-dev`, packaged `argus` (`main.ts:63`, unchanged).
- Work on branch `feat/deep-link-launcher`. Never push, tag or release without Antonio asking.

## Deviations from the spec (decided while planning, spec updated in Task 11)

1. **Launchers get their own file** (`server/data/launchers.json`, `LauncherStore`) instead of `AppConfig.launchers`. `PUT /api/config` never sees launchers, so the carry-forward/removal-only rule is unnecessary and remote config writes can't touch them. `launchFolderRoots` stays in `AppConfig` (it only drives warnings).
2. **"Review pending launch" is an app-menu item** (⌥⌘L, `menu:review-launch`) instead of a command-palette entry. The palette has no generic action list, and menu accelerators are the only shortcuts that reach a native terminal tile (see `menuShortcuts.ts`).
3. **No dock badge for pending launches.** The renderer already owns `dock:setBadge` for waiting sessions, and a second writer would clobber it. The system notification covers the background case.
4. **Toasts have no action buttons** (the `Toast` primitive is message + tone, 1.5 s). "Started X · View" becomes "Started X" plus the existing tile highlight. "Copy link" on errors is dropped.
5. **Sheets overlap the card stack.** Instead of the stack collapsing while a sheet is open, it renders at `--z-pop` (sheets are `--z-sheet`), so sheets naturally cover it, and it suppresses native overlays under its own rect (overlay suppression contract).

## Review Focus

1. **Link clicked while Argus is closed:** cold start. Expect the card (or the trusted run) to appear once the main window has loaded and restore has settled. Nothing lost, nothing run twice. → Task 8 manual e2e step + gate test "queued links drain once ready".
2. **Same `run/<id>` clicked twice quickly:** expect one session and a focus on the second click, not two tiles. → Task 7 test "run with a live session focuses, no spawn" + Task 6 test.
3. **A prompt with quotes, `$()`, newlines or a leading `-`:** expect it rejected (leading `-`) or passed byte-exact as one argv entry, and never re-sent on restart. → Task 2 + Task 4 tests.
4. **Unrelated Settings save after creating launchers:** expect the launchers to survive. → Task 5 test "config PUT never touches launchers.json" (the separate file makes this structural).
5. **Card window closed while a card is pending:** expect the card to move to `main`, not vanish. → Task 7 test "rehome moves cards to main".

---

### Task 1: Register the dev scheme

**Files:**
- Create: `scripts/register-dev-scheme.mjs`
- Modify: `package.json` (`scripts.postinstall`, `scripts.electron:dev`)
- Modify: `README.md` (new "Testing deep links" subsection)

**Interfaces:**
- Consumes: nothing.
- Produces: `argus-dev://` routed by LaunchServices to `node_modules/electron/dist/Electron.app` (the dev app).

- [ ] **Step 1: Create the branch**

```bash
cd /Users/macbookpro10/development/projects/argus
git checkout -b feat/deep-link-launcher
```

- [ ] **Step 2: Write the script**

`scripts/register-dev-scheme.mjs`:

```js
#!/usr/bin/env node
// Registers the dev deep-link scheme (argus-dev://) on the stock Electron.app that
// `npm run dev` launches. macOS only honours URL schemes declared in the bundle's
// Info.plist, so the runtime setAsDefaultProtocolClient('argus-dev') call in
// main.ts is a no-op without this. Idempotent; no-op off macOS or without Electron.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = join(app, 'Contents', 'Info.plist');
const LSREG = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
if (!existsSync(plist)) process.exit(0);

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const read = () => { try { return run('/usr/bin/plutil', ['-extract', 'CFBundleURLTypes', 'json', '-o', '-', plist]); } catch { return ''; } };

if (!read().includes('"argus-dev"')) {
  const entry = JSON.stringify([{ CFBundleURLName: 'Argus Dev', CFBundleURLSchemes: ['argus-dev'] }]);
  try { run('/usr/bin/plutil', ['-remove', 'CFBundleURLTypes', plist]); } catch { /* absent */ }
  run('/usr/bin/plutil', ['-insert', 'CFBundleURLTypes', '-json', entry, plist]);
  // Editing Info.plist invalidates the bundle signature; re-sign ad hoc so the
  // dev app still launches on Apple Silicon.
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
  run('/usr/bin/codesign', ['--verify', app]);
}
run(LSREG, ['-f', app]);
console.log('[register-dev-scheme] argus-dev:// → ' + app);
```

- [ ] **Step 3: Wire it**

In `package.json` scripts:
- `"postinstall": "node scripts/postinstall.js && node scripts/register-dev-scheme.mjs"`
- `"electron:dev"`: insert `node scripts/register-dev-scheme.mjs && ` immediately before `ARGUS_PORT=5403 electron .`.

- [ ] **Step 4: Verify**

```bash
node scripts/register-dev-scheme.mjs
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump | grep -E "claimed schemes:.*argus"
node scripts/register-dev-scheme.mjs   # second run: prints the same line, no codesign
```

Expected: the dump shows both `argus:` and `argus-dev:`.

- [ ] **Step 5: README**

Under the development section of `README.md`, add:

```markdown
### Testing deep links

`npm run dev` registers `argus-dev://` on the dev Electron.app (`scripts/register-dev-scheme.mjs`, also run on `npm install`). With the dev app running:

    open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=hello"

The installed app keeps `argus://`; the two never collide. If the dev app is not running, the link opens a bare Electron window. Start `npm run dev` first.
```

- [ ] **Step 6: Commit**

```bash
npm run verify
git add scripts/register-dev-scheme.mjs package.json README.md
git commit -m "chore: register argus-dev:// on the dev Electron.app"
```

---

### Task 2: Shared types + URL parser

**Files:**
- Modify: `shared/src/types.ts` (add types after `AgentStatus`; add `promptFlag` to `AgentDefinition`; add `launchFolderRoots` to `AppConfig` + `DEFAULT_CONFIG`)
- Modify: `server/src/persistence/ConfigStore.ts` (`DEFAULT_CONFIG`: add `launchFolderRoots`)
- Create: `electron/src/launchLink.ts`
- Test: `electron/src/launchLink.test.ts`

**Interfaces:**
- Produces (shared, types only):

```ts
export interface LaunchRequest {
  agent: string; folder: string; flags: string[]; prompt?: string;
  engine?: TerminalEngine; mode?: RunMode; name?: string;
  worktree?: string; base?: string;
}
export type LaunchWarningKind = 'worktree' | 'folder-outside-roots' | 'folder-agent-config' | 'launcher-changed';
export interface LaunchWarning { kind: LaunchWarningKind; detail: string }
export interface ValidatedLaunch {
  request: LaunchRequest;          // folder realpath'd
  agentCommand: string;            // resolved agent command
  args: string[];                  // flags + prompt args, spawn order
  command: string;                 // display string (Argus injection omitted)
  warnings: LaunchWarning[];
  folderAgentConfig: string[];     // names found: '.claude', '.mcp.json', 'CLAUDE.md'
}
export type ValidationResult = { ok: true; value: ValidatedLaunch } | { ok: false; error: string };
export interface Launcher {
  id: string; label: string; request: LaunchRequest;
  agentCommand: string; folderConfigAtSave: string[]; createdAt: string;
}
export type RunResolution =
  | { kind: 'unknown' }
  | { kind: 'invalid'; error: string }
  | { kind: 'live'; sessionId: string }
  | { kind: 'changed'; launcher: Launcher; validated: ValidatedLaunch }
  | { kind: 'ready'; launcher: Launcher; validated: ValidatedLaunch };
export type PendingLaunchState = 'pending' | 'starting' | 'error' | 'expired';
export interface PendingLaunchView {
  id: string; source: 'new' | 'run'; launcherId?: string; label: string;
  agent: string; folder: string; args: string[]; prompt?: string; command: string;
  engine?: TerminalEngine; mode?: RunMode; name?: string; worktree?: string; base?: string;
  warnings: LaunchWarning[]; state: PendingLaunchState; error?: string;
  receivedAt: number; canSaveAsLauncher: boolean;
}
export interface SaveAsLauncher { id: string; label: string; overwrite?: boolean }
export type LaunchActionResult = { ok: true } | { ok: false; error: string };
```

- Produces (electron): `parseLaunchUrl(url: string, scheme: string, home: string): ParsedLink` (see code).

- [ ] **Step 1: Add the shared types**

In `shared/src/types.ts`:
- Add `promptFlag?: string;` to `AgentDefinition`, with doc comment `/** Custom agents: flag that carries an initial prompt (e.g. "-i"). Built-ins need none. */`.
- Add `launchFolderRoots?: string[];` to `AppConfig`, with comment `// Launch links outside these roots get a warning on the approval card.`.
- Add `launchFolderRoots: ['~/development'],` to `DEFAULT_CONFIG`.
- Append the types from **Interfaces** above after `AgentStatus`.

Add the same `launchFolderRoots: ['~/development'],` line to `DEFAULT_CONFIG` in `server/src/persistence/ConfigStore.ts` (`check:deps` compares the two literals).

- [ ] **Step 2: Write the failing parser tests**

`electron/src/launchLink.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLaunchUrl } from './launchLink.js';

const H = '/Users/me';
const p = (u: string) => parseLaunchUrl(u, 'argus', H);
const newReq = (u: string) => { const r = p(u); assert.ok(r.ok && r.kind === 'new', JSON.stringify(r)); return (r as any).request; };
const err = (u: string) => { const r = p(u); assert.equal(r.ok, false, JSON.stringify(r)); return (r as any).error; };

test('new: all params map, flags keep order, ~ expands', () => {
  const r = newReq('argus://new?agent=claude&folder=~/dev/x&prompt=refresh%20dashboard&flag=--model=opus&flag=--verbose&engine=native&mode=direct&name=JarvAR&worktree=feat/x&base=main');
  assert.deepEqual(r, { agent: 'claude', folder: '/Users/me/dev/x', flags: ['--model=opus', '--verbose'], prompt: 'refresh dashboard', engine: 'native', mode: 'direct', name: 'JarvAR', worktree: 'feat/x', base: 'main' });
});

test('new: minimal request', () => {
  assert.deepEqual(newReq('argus://new?agent=claude&folder=/tmp'), { agent: 'claude', folder: '/tmp', flags: [] });
});

test('new: rejections', () => {
  assert.equal(err('argus://new?folder=/tmp'), 'missing-agent');
  assert.equal(err('argus://new?agent=claude'), 'missing-folder');
  assert.equal(err('argus://new?agent=claude&folder=relative/x'), 'bad-folder');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&x=1'), 'unknown-param');
  assert.equal(err('argus://new?agent=claude&agent=codex&folder=/tmp'), 'duplicate-param');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&engine=gpu'), 'bad-engine');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&mode=forever'), 'bad-mode');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&flag=model'), 'bad-flag-shape');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&flag=--a%20b'), 'bad-flag-shape');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&base=main'), 'base-without-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&worktree=-x'), 'bad-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&worktree=a/../b'), 'bad-worktree');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=' + 'a'.repeat(9000)), 'too-long');
});

test('new: prompt rules', () => {
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=--dangerously-skip-permissions'), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=%20%20-p'), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=' + 'a'.repeat(4097)), 'bad-prompt');
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%E2%80%AEb'), 'bad-prompt');   // U+202E RLO
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%E2%80%8Bb'), 'bad-prompt');   // zero-width space
  assert.equal(err('argus://new?agent=claude&folder=/tmp&prompt=a%1Bb'), 'bad-prompt');         // ESC
  assert.equal(newReq('argus://new?agent=claude&folder=/tmp&prompt=line1%0Aline2').prompt, 'line1\nline2');
  assert.equal(newReq("argus://new?agent=claude&folder=/tmp&prompt=it's%20%24(rm)%20%60x%60%3B").prompt, "it's $(rm) `x`;");
});

test('new: name and folder reject control and format chars', () => {
  assert.equal(err('argus://new?agent=claude&folder=/tmp&name=a%0Ab'), 'bad-name');
  assert.equal(err('argus://new?agent=claude&folder=/tmp%E2%80%AE'), 'bad-folder');
});

test('run: id only, no params', () => {
  const r = p('argus://run/jarvar-refresh');
  assert.deepEqual(r, { ok: true, kind: 'run', launcherId: 'jarvar-refresh' });
  assert.equal(err('argus://run/Bad_Id'), 'bad-launcher-id');
  assert.equal(err('argus://run/'), 'bad-launcher-id');
  assert.equal(err('argus://run/ok?prompt=x'), 'unknown-param');
});

test('notif keeps working; wrong scheme and host rejected', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(p(`argus://notif/${id}`), { ok: true, kind: 'notif', sessionId: id });
  assert.equal(err('argus-dev://new?agent=claude&folder=/tmp'), 'wrong-scheme');
  assert.equal(err('argus://delete?x=1'), 'unknown-host');
  assert.equal(err('not a url'), 'wrong-scheme');
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run build:electron && node --test electron/dist/launchLink.test.js`
Expected: build FAILS: `Cannot find module './launchLink.js'`.

- [ ] **Step 4: Implement**

`electron/src/launchLink.ts`:

```ts
import type { LaunchRequest, RunMode, TerminalEngine } from '@argus/shared';

export type LinkErrorClass =
  | 'wrong-scheme' | 'unknown-host' | 'too-long' | 'unknown-param' | 'duplicate-param'
  | 'missing-agent' | 'missing-folder' | 'bad-folder' | 'bad-engine' | 'bad-mode'
  | 'bad-flag-shape' | 'bad-prompt' | 'bad-name' | 'bad-worktree' | 'base-without-worktree'
  | 'bad-launcher-id' | 'bad-notif-id';

export type ParsedLink =
  | { ok: true; kind: 'new'; request: LaunchRequest }
  | { ok: true; kind: 'run'; launcherId: string }
  | { ok: true; kind: 'notif'; sessionId: string }
  | { ok: false; error: LinkErrorClass };

export const MAX_URL = 8192;
export const MAX_PROMPT = 4096;
export const LAUNCHER_ID_RE = /^[a-z0-9-]{1,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SINGLETONS = ['agent', 'folder', 'prompt', 'engine', 'mode', 'name', 'worktree', 'base'] as const;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const CONTROL_EXCEPT_NL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;
const FORMAT = /\p{Cf}/u;
const REF_RE = /^(?!-)[A-Za-z0-9._/-]+$/;

const fail = (error: LinkErrorClass): ParsedLink => ({ ok: false, error });
const cleanText = (s: string) => !CONTROL.test(s) && !FORMAT.test(s);
const goodRef = (s: string) => REF_RE.test(s) && !s.includes('..');

export function parseLaunchUrl(raw: string, scheme: string, home: string): ParsedLink {
  let url: URL;
  try { url = new URL(raw); } catch { return fail('wrong-scheme'); }
  if (url.protocol !== `${scheme}:`) return fail('wrong-scheme');
  if (raw.length > MAX_URL) return fail('too-long');
  const path = url.pathname.replace(/\/$/, '');

  if (url.host === 'notif') {
    const id = path.replace(/^\//, '');
    return UUID_RE.test(id) ? { ok: true, kind: 'notif', sessionId: id } : fail('bad-notif-id');
  }
  if (url.host === 'run') {
    if (url.search) return fail('unknown-param');
    const id = path.replace(/^\//, '');
    return LAUNCHER_ID_RE.test(id) ? { ok: true, kind: 'run', launcherId: id } : fail('bad-launcher-id');
  }
  if (url.host !== 'new') return fail('unknown-host');

  const params = url.searchParams;
  for (const key of new Set(params.keys())) {
    if (key !== 'flag' && !(SINGLETONS as readonly string[]).includes(key)) return fail('unknown-param');
    if (key !== 'flag' && params.getAll(key).length > 1) return fail('duplicate-param');
  }
  const agent = params.get('agent');
  if (!agent) return fail('missing-agent');
  let folder = params.get('folder');
  if (!folder) return fail('missing-folder');
  if (folder === '~' || folder.startsWith('~/')) folder = home + folder.slice(1);
  if (!folder.startsWith('/') || !cleanText(folder)) return fail('bad-folder');

  const flags = params.getAll('flag');
  if (flags.some((f) => !/^-/.test(f) || /\s/.test(f) || !cleanText(f))) return fail('bad-flag-shape');

  const request: LaunchRequest = { agent, folder, flags };
  const prompt = params.get('prompt');
  if (prompt !== null) {
    if (prompt.length > MAX_PROMPT || prompt.trimStart().startsWith('-') || CONTROL_EXCEPT_NL.test(prompt) || FORMAT.test(prompt)) {
      return fail('bad-prompt');
    }
    request.prompt = prompt;
  }
  const engine = params.get('engine');
  if (engine !== null) {
    if (engine !== 'web' && engine !== 'native') return fail('bad-engine');
    request.engine = engine as TerminalEngine;
  }
  const mode = params.get('mode');
  if (mode !== null) {
    if (mode !== 'persistent' && mode !== 'direct') return fail('bad-mode');
    request.mode = mode as RunMode;
  }
  const name = params.get('name');
  if (name !== null) {
    if (!name.trim() || name.length > 60 || !cleanText(name)) return fail('bad-name');
    request.name = name;
  }
  const worktree = params.get('worktree');
  const base = params.get('base');
  if (base !== null && worktree === null) return fail('base-without-worktree');
  if (worktree !== null) {
    if (!goodRef(worktree) || (base !== null && !goodRef(base))) return fail('bad-worktree');
    request.worktree = worktree;
    if (base !== null) request.base = base;
  }
  return { ok: true, kind: 'new', request };
}
```

Note: the `too-long` check runs after the scheme check, so an 8 KB+ non-Argus string still reports `wrong-scheme`. The prompt-length test uses 9000 chars to exceed `MAX_URL` first. That's intended: the URL cap wins.

- [ ] **Step 5: Run to verify pass**

Run: `npm run build:electron && node --test electron/dist/launchLink.test.js`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
npm run verify
git add shared/src/types.ts server/src/persistence/ConfigStore.ts electron/src/launchLink.ts electron/src/launchLink.test.ts
git commit -m "feat(launch): shared launch types and argus:// link parser"
```

---

### Task 3: Server validation (`validateLaunch`) + prompt args

**Files:**
- Create: `server/src/utils/flags.ts` (move `FLAG_PATTERN` + `validateFlags` out of `routes/sessions.ts`)
- Modify: `server/src/routes/sessions.ts:9-19` (import from `../utils/flags.js`)
- Modify: `server/src/services/AgentRegistry.ts` (add exported `promptArgs`)
- Modify: `server/src/routes/config.ts` (`validateCustomAgents`: validate `promptFlag`)
- Create: `server/src/services/launch/validateLaunch.ts`
- Test: `server/src/services/launch/validateLaunch.test.ts`, `server/src/services/AgentRegistry.test.ts` (append)

**Interfaces:**
- Consumes: `LaunchRequest`, `ValidatedLaunch`, `ValidationResult`, `LaunchWarning` (Task 2); `shquote` from `server/src/services/PtyManager.ts:16`.
- Produces:
  - `validateFlags(flags: string[]): string | null` in `server/src/utils/flags.ts`
  - `promptArgs(agent: AgentDefinition, prompt: string): string[] | null`
  - `validateLaunch(req: LaunchRequest, deps: { agentRegistry: AgentRegistry; config: AppConfig; home: string }): Promise<ValidationResult>`
  - `AGENT_CONFIG_FILES = ['.claude', '.mcp.json', 'CLAUDE.md']`
  - `MAX_QUOTED_BYTES = 12288`

- [ ] **Step 1: Move flag validation (no behaviour change)**

`server/src/utils/flags.ts`:

```ts
// Only allow safe flag characters — blocks shell metacharacters like ; | & ` $() etc.
export const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/]*$/;

export function validateFlags(flags: string[]): string | null {
  for (const flag of flags) {
    if (!FLAG_PATTERN.test(flag.trim())) {
      return `Invalid flag: "${flag}". Flags must start with - or -- and contain only safe characters.`;
    }
  }
  return null;
}
```

In `routes/sessions.ts`, delete lines 9-19 (the comment, `FLAG_PATTERN` and `validateFlags`) and add `import { validateFlags } from '../utils/flags.js';`. Run `npm test -w server`; expected PASS (the existing `sessions.*.test.ts` cover the route).

- [ ] **Step 2: Failing tests for `promptArgs`**

Append to `server/src/services/AgentRegistry.test.ts`:

```ts
import { promptArgs, AgentRegistry as Reg } from './AgentRegistry.js';

test('promptArgs: built-ins and custom agents', () => {
  const r = new Reg();
  const get = (id: string) => r.getById(id, [])!;
  assert.deepEqual(promptArgs(get('claude'), 'hi'), ['hi']);
  assert.deepEqual(promptArgs(get('codex'), 'hi'), ['hi']);
  assert.deepEqual(promptArgs(get('gemini'), 'hi'), ['-i', 'hi']);
  const custom = { id: 'x', name: 'X', command: 'x', builtin: false };
  assert.equal(promptArgs(custom, 'hi'), null);
  assert.deepEqual(promptArgs({ ...custom, promptFlag: '--prompt' }, 'hi'), ['--prompt', 'hi']);
});
```

(If `test`/`assert` are already imported at the top of the file, reuse them and drop the duplicate import.)

- [ ] **Step 3: Implement `promptArgs`**

Append to `server/src/services/AgentRegistry.ts`:

```ts
/**
 * argv that carries an initial prompt for this agent, appended after every other
 * flag (and after Argus's signal injection). null = the agent can't take one.
 * Forms verified against each CLI's --help: see plan Task 3 Step 4.
 */
export function promptArgs(agent: AgentDefinition, prompt: string): string[] | null {
  if (agent.builtin) {
    if (agent.id === 'claude' || agent.id === 'codex') return [prompt];
    if (agent.id === 'gemini') return ['-i', prompt];
    return null;
  }
  return agent.promptFlag ? [agent.promptFlag, prompt] : null;
}
```

- [ ] **Step 4: Verify the CLI forms**

Run `claude --help | head -20`, `codex --help | head -30`, `gemini --help | grep -n -- '-i\b\|prompt-interactive'`. Confirm:
- claude: a positional `[prompt]` starts an **interactive** session
- codex: a positional `[PROMPT]` is interactive (not `codex exec`)
- gemini: `-i, --prompt-interactive` exists

If any differs, fix `promptArgs` and its test before continuing, and note the verified form in the doc comment. If a CLI isn't installed, leave its entry and note "unverified" in the commit message.

- [ ] **Step 5: Validate `promptFlag` on custom agents**

In `routes/config.ts` `validateCustomAgents`, inside the loop after the `COMMAND_PATTERN` check, add:

```ts
    if (a.promptFlag !== undefined && !/^--?[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(a.promptFlag)) {
      return `Invalid prompt flag "${a.promptFlag}" for agent "${a.name}".`;
    }
```

Add to `server/src/routes/config.test.ts` a case following that file's existing PUT pattern: a custom agent with `promptFlag: '--p; rm'` → 400; with `promptFlag: '-i'` → 200.

- [ ] **Step 6: Failing tests for `validateLaunch`**

`server/src/services/launch/validateLaunch.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../AgentRegistry.js';
import { validateLaunch, MAX_QUOTED_BYTES } from './validateLaunch.js';

function fixture(t: any) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-vl-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const inRoot = path.join(home, 'development', 'proj');
  const outside = path.join(home, 'Downloads', 'x');
  mkdirSync(inRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const config = { customAgents: [], launchFolderRoots: ['~/development'] } as any;
  const deps = { agentRegistry: new AgentRegistry(), config, home };
  return { home, inRoot, outside, deps };
}

test('valid request: args, display command, no warnings inside roots', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot, flags: ['--model=opus'], prompt: "it's done" }, deps);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.args, ['--model=opus', "it's done"]);
  assert.equal(r.value.command, `claude --model=opus 'it'\\''s done'`);
  assert.equal(r.value.agentCommand, 'claude');
  assert.deepEqual(r.value.warnings, []);
});

test('rejects unknown agent, missing folder, file as folder, bad flags', async (t) => {
  const { inRoot, deps } = fixture(t);
  const file = path.join(inRoot, 'f.txt'); writeFileSync(file, 'x');
  assert.equal((await validateLaunch({ agent: 'nope', folder: inRoot, flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: inRoot + '/missing', flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: file, flags: [] }, deps)).ok, false);
  assert.equal((await validateLaunch({ agent: 'claude', folder: inRoot, flags: ['--a;b'] }, deps)).ok, false);
});

test('prompt on an agent without prompt support is rejected', async (t) => {
  const { inRoot, deps } = fixture(t);
  deps.config.customAgents = [{ id: 'x', name: 'X', command: 'x', builtin: false }];
  const r = await validateLaunch({ agent: 'x', folder: inRoot, flags: [], prompt: 'hi' }, deps);
  assert.equal(r.ok, false);
});

test('quoted size cap', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot, flags: [], prompt: "'".repeat(4000) }, deps);
  assert.equal(r.ok, false);
  assert.match((r as any).error, new RegExp(String(MAX_QUOTED_BYTES)));
});

test('warnings: outside roots, agent config, worktree', async (t) => {
  const { outside, deps } = fixture(t);
  mkdirSync(path.join(outside, '.claude'));
  writeFileSync(path.join(outside, 'CLAUDE.md'), '#');
  const r = await validateLaunch({ agent: 'claude', folder: outside, flags: [], worktree: 'feat/x', base: 'main' }, deps);
  assert.ok(r.ok);
  const kinds = r.value.warnings.map((w) => w.kind).sort();
  assert.deepEqual(kinds, ['folder-agent-config', 'folder-outside-roots', 'worktree']);
  assert.deepEqual(r.value.folderAgentConfig, ['.claude', 'CLAUDE.md']);
});

test('folder is realpath-resolved', async (t) => {
  const { inRoot, deps } = fixture(t);
  const r = await validateLaunch({ agent: 'claude', folder: inRoot + '/./', flags: [] }, deps);
  assert.ok(r.ok);
  assert.equal(r.value.request.folder, inRoot);
});
```

- [ ] **Step 7: Run to verify failure**

Run: `cd server && node --import tsx --test src/services/launch/validateLaunch.test.ts`
Expected: FAIL, `Cannot find module './validateLaunch.js'`.

- [ ] **Step 8: Implement**

`server/src/services/launch/validateLaunch.ts`:

```ts
import { realpath, stat, access } from 'fs/promises';
import path from 'path';
import type { AppConfig, LaunchRequest, LaunchWarning, ValidationResult } from '@argus/shared';
import type { AgentRegistry } from '../AgentRegistry.js';
import { promptArgs } from '../AgentRegistry.js';
import { shquote } from '../PtyManager.js';
import { validateFlags } from '../../utils/flags.js';

export const AGENT_CONFIG_FILES = ['.claude', '.mcp.json', 'CLAUDE.md'];
/** tmux caps one command near 16 KB; the tmux path quotes the agent line twice. */
export const MAX_QUOTED_BYTES = 12288;

export interface ValidateDeps { agentRegistry: AgentRegistry; config: AppConfig; home: string }

const SAFE_WORD = /^[A-Za-z0-9_@%+=:,./-]+$/;
const displayWord = (s: string) => (SAFE_WORD.test(s) ? s : shquote(s));
const expandHome = (p: string, home: string) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p);

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function validateLaunch(req: LaunchRequest, deps: ValidateDeps): Promise<ValidationResult> {
  const agent = deps.agentRegistry.getById(req.agent, deps.config.customAgents ?? []);
  if (!agent) return { ok: false, error: `Unknown agent "${req.agent}"` };

  let folder: string;
  try {
    folder = await realpath(req.folder);
    if (!(await stat(folder)).isDirectory()) return { ok: false, error: 'Folder is not a directory' };
  } catch {
    return { ok: false, error: 'Folder does not exist' };
  }

  const flagError = validateFlags(req.flags);
  if (flagError) return { ok: false, error: flagError };

  let tail: string[] = [];
  if (req.prompt !== undefined) {
    const pa = promptArgs(agent, req.prompt);
    if (!pa) return { ok: false, error: `Agent "${agent.name}" does not accept an initial prompt` };
    tail = pa;
  }
  const args = [...req.flags, ...tail];

  const inner = `exec ${[agent.command, ...args.map(shquote)].join(' ')}`;
  if (Buffer.byteLength(shquote(inner)) > MAX_QUOTED_BYTES) {
    return { ok: false, error: `Command too long after quoting (max ${MAX_QUOTED_BYTES} bytes)` };
  }

  const warnings: LaunchWarning[] = [];
  const roots = await Promise.all(
    (deps.config.launchFolderRoots ?? []).map(async (r) => {
      const abs = expandHome(r, deps.home);
      try { return await realpath(abs); } catch { return path.resolve(abs); }
    }),
  );
  if (!roots.some((r) => folder === r || folder.startsWith(r + path.sep))) {
    warnings.push({ kind: 'folder-outside-roots', detail: `Outside ${(deps.config.launchFolderRoots ?? []).join(', ') || 'any configured root'}` });
  }
  const folderAgentConfig: string[] = [];
  for (const f of AGENT_CONFIG_FILES) if (await exists(path.join(folder, f))) folderAgentConfig.push(f);
  if (folderAgentConfig.length) {
    warnings.push({ kind: 'folder-agent-config', detail: `Loads when the agent starts: ${folderAgentConfig.join(', ')}` });
  }
  if (req.worktree) {
    warnings.push({ kind: 'worktree', detail: `Creates branch ${req.worktree} from ${req.base ?? 'HEAD'}` });
  }

  return {
    ok: true,
    value: {
      request: { ...req, folder },
      agentCommand: agent.command,
      args,
      command: [agent.command, ...args].map(displayWord).join(' '),
      warnings,
      folderAgentConfig,
    },
  };
}
```

- [ ] **Step 9: Run to verify pass**

Run: `cd server && node --import tsx --test src/services/launch/validateLaunch.test.ts src/services/AgentRegistry.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
npm run verify
git add server/src/utils/flags.ts server/src/routes/sessions.ts server/src/routes/config.ts server/src/routes/config.test.ts server/src/services/AgentRegistry.ts server/src/services/AgentRegistry.test.ts server/src/services/launch/
git commit -m "feat(launch): server-side launch validation, prompt args, folder warnings"
```

---

### Task 4: `initialPrompt` + `launcherId` in SessionManager

**Files:**
- Modify: `server/src/services/SessionManager.ts` (`createSession` signature at `:489`; `spawnFlags` at ~`:585`; `ManagedSession`; `toSessionInfo` ~`:1770`; `persistSessions` ~`:1841`; `restoreSessions` ~`:1733,1753`; add `findLiveByLauncher`)
- Modify: `server/src/persistence/SessionStore.ts` (`PersistedSession.launcherId?`)
- Modify: `shared/src/types.ts` (`SessionInfo.launcherId?: string`)
- Test: `server/src/services/SessionManager.launch.test.ts`

**Interfaces:**
- Consumes: `promptArgs` (Task 3).
- Produces:
  - `export interface CreateSessionOpts { initialPrompt?: string; launcherId?: string }`
  - `createSession(…existing 12 params…, opts: CreateSessionOpts = {})`
  - `findLiveByLauncher(launcherId: string): SessionInfo | undefined` (status ≠ `exited`)

- [ ] **Step 1: Failing tests**

`server/src/services/SessionManager.launch.test.ts` (harness copied from `SessionManager.runMode.test.ts`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import { SessionManager } from './SessionManager.js';

process.env.ARGUS_PTY_BACKEND = 'tmux';

const cfg = { load: async () => ({ defaultAgent: 'claude', customAgents: [], agentFlags: {} }), save: async () => {} } as any;

function harness() {
  const sm = new SessionManager(os.tmpdir(), cfg);
  sm.setSignalConfig('secret', '/opt/argus/bin/argus-signal');
  const spawns: any[] = [];
  const pty = () => ({
    pid: 1, cols: 120, rows: 30, process: 'x', handleFlowControl: false,
    onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }),
    write() {}, resize() {}, clear() {}, kill() {}, pause() {}, resume() {},
  });
  const b = {
    kind: 'daemon', isPersistent: () => true,
    spawn: (o: any) => { spawns.push(o); return pty(); },
    seedMirror() {}, writeWheel() {}, detach() {}, stopSession() {}, stopAll() {},
    listSurvivors: async () => new Set<string>(), isSurvivorDead: () => true, reapOrphans: async () => {},
  };
  (sm as any).backend = b;
  (sm as any).directBackend = b;
  const persisted: any[][] = [];
  (sm as any).store = { save: async (d: any[]) => { persisted.push(d); }, load: async () => persisted.at(-1) ?? [] };
  (sm as any).fileWatcher = { watch() {}, stop: async () => {}, stopAll: async () => {} };
  return { sm, spawns, persisted };
}

const create = (sm: SessionManager, flags: string[], opts: any) =>
  sm.createSession(os.tmpdir(), 'n', 'claude', flags, undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, opts);

test('prompt is the last argv entry, after signal injection', async () => {
  const { sm, spawns } = harness();
  await create(sm, ['--model=opus'], { initialPrompt: 'settings=/x notify=x' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags.at(-1), 'settings=/x notify=x');
  const settingsIdx = flags.indexOf('--settings');
  assert.ok(settingsIdx >= 0 && settingsIdx < flags.length - 1, 'injected --settings precedes the prompt');
  assert.ok(!flags.includes('/x'), 'prompt never parsed as a --settings value');
});

test('prompt text that looks like injection flags is not parsed by the adapter', async () => {
  const { sm, spawns } = harness();
  await create(sm, [], { initialPrompt: 'use --settings=/tmp/evil.json please' });
  const flags: string[] = spawns[0].flags;
  assert.equal(flags.at(-1), 'use --settings=/tmp/evil.json please');
  assert.equal(flags.filter((f) => f === '--settings').length, 1, 'only Argus\'s own --settings');
});

test('session flags and persistence keep the original flags; prompt never persisted; launcherId persisted', async () => {
  const { sm, persisted } = harness();
  const s = await create(sm, ['--model=opus'], { initialPrompt: 'hello', launcherId: 'jarvar-refresh' });
  assert.deepEqual(s.flags, ['--model=opus']);
  assert.equal(s.launcherId, 'jarvar-refresh');
  const rec = persisted.at(-1)!.find((p: any) => p.id === s.id);
  assert.deepEqual(rec.flags, ['--model=opus']);
  assert.equal(rec.launcherId, 'jarvar-refresh');
  assert.ok(!JSON.stringify(persisted).includes('hello'));
});

test('restart does not replay the prompt', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello' });
  await sm.restartSession(s.id);
  assert.equal(spawns.length, 2);
  assert.ok(!spawns[1].flags.includes('hello'));
});

test('restore does not replay the prompt and keeps launcherId', async () => {
  const { sm, spawns } = harness();
  const s = await create(sm, [], { initialPrompt: 'hello', launcherId: 'l1' });
  (sm as any).sessions.clear();
  await sm.restoreSessions();
  const last = spawns.at(-1);
  assert.ok(!last.flags.includes('hello'));
  assert.equal(sm.findLiveByLauncher('l1')?.id, s.id);
});

test('findLiveByLauncher ignores exited sessions', async () => {
  const { sm } = harness();
  const s = await create(sm, [], { launcherId: 'l2' });
  (sm as any).sessions.get(s.id).status = 'exited';
  assert.equal(sm.findLiveByLauncher('l2'), undefined);
});

test('prompt on an agent without prompt support throws', async () => {
  const { sm } = harness();
  (sm as any).configStore = { load: async () => ({ defaultAgent: 'claude', customAgents: [{ id: 'x', name: 'X', command: 'x', builtin: false }], agentFlags: {} }) };
  await assert.rejects(
    sm.createSession(os.tmpdir(), 'n', 'x', [], undefined, undefined, undefined, undefined, false, undefined, 'persistent', false, { initialPrompt: 'hi' }),
    /does not accept an initial prompt/,
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --import tsx --test src/services/SessionManager.launch.test.ts`
Expected: FAIL (the 13th argument is ignored, so the prompt is missing from the flags; `findLiveByLauncher` is not a function).

- [ ] **Step 3: Implement**

In `SessionManager.ts`:

1. Next to the other imports, add `import { promptArgs } from './AgentRegistry.js';`, and export an options interface near the top-level types:

```ts
/** Launch-only extras (deep links). Never reachable from REST/Socket.io. */
export interface CreateSessionOpts {
  /** Appended after signal injection on a FRESH create only; never stored. */
  initialPrompt?: string;
  /** The saved launcher this session was started from (metadata). */
  launcherId?: string;
}
```

2. `ManagedSession`: add `launcherId?: string;` with comment `/** Launcher that started this session (deep link run/<id>); focus-if-live key. */`.

3. `createSession` signature: append `, opts: CreateSessionOpts = {}` after `restoreExited = false`.

4. Replace `const spawnFlags = inj?.flags ?? resolvedFlags;` with:

```ts
    // Initial prompt (deep links): appended AFTER signal injection so no adapter
    // ever parses prompt text, and only on a fresh create — restore/reattach and
    // restartSession never pass opts.initialPrompt, so it can't be replayed.
    let promptTail: string[] = [];
    if (opts.initialPrompt !== undefined && !attachExisting && !restoreExited && existingId == null) {
      const pa = agentDef ? promptArgs(agentDef, opts.initialPrompt) : null;
      if (!pa) throw new Error(`Agent "${resolvedAgentType}" does not accept an initial prompt`);
      promptTail = pa;
    }
    const spawnFlags = [...(inj?.flags ?? resolvedFlags), ...promptTail];
```

This throw must happen **before** `inj.files` are written. Move the block above `const inj = …` and keep the final `spawnFlags` line where the old one was:

```ts
    let promptTail: string[] = [];
    if (/* same condition */) { /* same body */ }
    const inj = …;               // unchanged
    …                            // unchanged file writes
    const spawnFlags = [...(inj?.flags ?? resolvedFlags), ...promptTail];
```

5. In the `session: ManagedSession = { … }` literal add `launcherId: opts.launcherId,`.

6. `toSessionInfo`: add `launcherId: session.launcherId,`. `persistSessions` mapping: add `launcherId: s.launcherId,`.

7. `restoreSessions`: pass `{ launcherId: p.launcherId }` as the 13th argument in **both** `createSession` calls (the direct `restoreExited` call and the persistent call). There is no `initialPrompt`.

8. Add the method (next to `getAllSessions`):

```ts
  /** A non-exited session started from this launcher, if any (deep-link focus-if-live). */
  findLiveByLauncher(launcherId: string): SessionInfo | undefined {
    for (const s of this.sessions.values()) {
      if (s.launcherId === launcherId && s.status !== 'exited') return this.toSessionInfo(s);
    }
    return undefined;
  }
```

In `SessionStore.ts` add `launcherId?: string;` to `PersistedSession`. In `shared/src/types.ts` add `launcherId?: string;` to `SessionInfo` with comment `/** Deep-link launcher that started this session. */`.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && node --import tsx --test src/services/SessionManager.launch.test.ts src/services/SessionManager.runMode.test.ts src/services/SessionManager.signalInjection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run verify
git add server/src/services/SessionManager.ts server/src/services/SessionManager.launch.test.ts server/src/persistence/SessionStore.ts shared/src/types.ts
git commit -m "feat(launch): first-spawn-only initial prompt and launcherId on sessions"
```

---

### Task 5: `LauncherStore` + `launchFolderRoots` config key

**Files:**
- Create: `server/src/persistence/LauncherStore.ts`
- Test: `server/src/persistence/LauncherStore.test.ts`
- Modify: `server/src/routes/config.ts` (PUT allowlist: `launchFolderRoots`)
- Test: `server/src/routes/config.test.ts` (append)

**Interfaces:**
- Consumes: `Launcher` (Task 2).
- Produces: `class LauncherStore { constructor(filePath: string); load(): Promise<Launcher[]>; save(list: Launcher[]): Promise<void> }`

- [ ] **Step 1: Failing store tests**

`server/src/persistence/LauncherStore.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LauncherStore } from './LauncherStore.js';

const L = (id: string) => ({
  id, label: id, request: { agent: 'claude', folder: '/tmp', flags: [] },
  agentCommand: 'claude', folderConfigAtSave: [], createdAt: '2026-09-30T00:00:00.000Z',
});
const dir = (t: any) => { const d = mkdtempSync(path.join(os.tmpdir(), 'argus-ls-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test('missing file → empty list', async (t) => {
  assert.deepEqual(await new LauncherStore(path.join(dir(t), 'launchers.json')).load(), []);
});

test('round-trip', async (t) => {
  const s = new LauncherStore(path.join(dir(t), 'launchers.json'));
  await s.save([L('a'), L('b')]);
  assert.deepEqual((await s.load()).map((l) => l.id), ['a', 'b']);
});

test('drops malformed entries and non-array files', async (t) => {
  const d = dir(t);
  const f = path.join(d, 'launchers.json');
  writeFileSync(f, JSON.stringify([L('ok'), { id: 'BAD ID' }, { nope: 1 }]));
  assert.deepEqual((await new LauncherStore(f).load()).map((l) => l.id), ['ok']);
  writeFileSync(f, '{"not":"array"}');
  assert.deepEqual(await new LauncherStore(f).load(), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --import tsx --test src/persistence/LauncherStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server/src/persistence/LauncherStore.ts`:

```ts
import { readFile } from 'fs/promises';
import type { Launcher } from '@argus/shared';
import { atomicWrite } from '../utils/atomicWrite.js';

const ID_RE = /^[a-z0-9-]{1,40}$/;

function isLauncher(v: unknown): v is Launcher {
  const l = v as Launcher;
  return !!l && typeof l === 'object'
    && typeof l.id === 'string' && ID_RE.test(l.id)
    && typeof l.label === 'string'
    && typeof l.agentCommand === 'string'
    && Array.isArray(l.folderConfigAtSave)
    && !!l.request && typeof l.request.agent === 'string' && typeof l.request.folder === 'string'
    && Array.isArray(l.request.flags);
}

/**
 * Saved deep-link launchers (argus://run/<id>). A file of its own, deliberately
 * not an AppConfig key: PUT /api/config rebuilds config from an allowlist and is
 * reachable remotely (ngrok), so launchers never pass through it. Only the
 * Electron main-process IPC path writes here (LaunchService).
 */
export class LauncherStore {
  constructor(private filePath: string) {}

  async load(): Promise<Launcher[]> {
    try {
      const data = JSON.parse(await readFile(this.filePath, 'utf-8'));
      return Array.isArray(data) ? data.filter(isLauncher) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('[LauncherStore] load failed:', err);
      return [];
    }
  }

  async save(list: Launcher[]): Promise<void> {
    await atomicWrite(this.filePath, JSON.stringify(list, null, 2));
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && node --import tsx --test src/persistence/LauncherStore.test.ts`
Expected: PASS.

- [ ] **Step 5: `launchFolderRoots` in the config PUT (failing test first)**

Append to `server/src/routes/config.test.ts`, following its existing PUT request helper:
- PUT `{ launchFolderRoots: ['~/work', '/opt/x'] }` → response and next GET contain it.
- PUT `{ launchFolderRoots: 'nope' }` → value unchanged (current kept).
- PUT `{ launchFolderRoots: ['a'.repeat(600)] }` → unchanged (entries capped at 512 chars).
- PUT `{}` (unrelated save) → `launchFolderRoots` unchanged.

Run: `cd server && node --import tsx --test src/routes/config.test.ts` → FAIL.

Then in `routes/config.ts` PUT:
- add `launchFolderRoots` to the destructured `req.body` list
- add to `updated`:

```ts
      launchFolderRoots: Array.isArray(launchFolderRoots)
        && launchFolderRoots.length <= 20
        && launchFolderRoots.every((r: unknown) => typeof r === 'string' && r.trim().length > 0 && r.length <= 512)
        ? launchFolderRoots.map((r: string) => r.trim())
        : current.launchFolderRoots,
```

Run again → PASS.

- [ ] **Step 6: Commit**

```bash
npm run verify
git add server/src/persistence/LauncherStore.ts server/src/persistence/LauncherStore.test.ts server/src/routes/config.ts server/src/routes/config.test.ts
git commit -m "feat(launch): launcher store (own file) and launchFolderRoots setting"
```

---

### Task 6: `LaunchService` + in-process server exports

**Files:**
- Create: `server/src/services/launch/LaunchService.ts`
- Test: `server/src/services/launch/LaunchService.test.ts`
- Modify: `server/src/index.ts` (construct the store and service; export `getLaunchService`, `hostLaunch`, `whenSessionsRestored`; keep the restore promise)

**Interfaces:**
- Consumes: `validateLaunch` (Task 3), `LauncherStore` (Task 5), `SessionManager.createSession(…, opts)` + `findLiveByLauncher` (Task 4), `WindowRegistry.assign(sessionId, windowId)` (`server/src/services/WindowRegistry.ts:89`).
- Produces:

```ts
export interface LaunchServiceDeps {
  store: { load(): Promise<Launcher[]>; save(l: Launcher[]): Promise<void> };
  loadConfig: () => Promise<AppConfig>;
  agentRegistry: AgentRegistry;
  home: string;
  findLiveByLauncher: (launcherId: string) => SessionInfo | undefined;
  now?: () => Date;
}
export class LaunchService {
  validate(req: LaunchRequest): Promise<ValidationResult>;
  resolveRun(launcherId: string): Promise<RunResolution>;
  list(): Promise<Launcher[]>;
  add(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult>;
  rename(id: string, label: string): Promise<LaunchActionResult>;
  remove(id: string): Promise<LaunchActionResult>;
}
// server/src/index.ts
export function getLaunchService(): LaunchService;
export async function hostLaunch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<SessionInfo>;
export function whenSessionsRestored(): Promise<void>;
```

- [ ] **Step 1: Failing tests**

`server/src/services/launch/LaunchService.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AgentRegistry } from '../AgentRegistry.js';
import { LaunchService } from './LaunchService.js';

function setup(t: any, live: Record<string, string> = {}) {
  const home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'argus-lsvc-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const folder = path.join(home, 'development', 'jarvar');
  mkdirSync(folder, { recursive: true });
  let saved: any[] = [];
  const config: any = { customAgents: [], launchFolderRoots: ['~/development'] };
  const svc = new LaunchService({
    store: { load: async () => saved, save: async (l) => { saved = l; } },
    loadConfig: async () => config,
    agentRegistry: new AgentRegistry(),
    home,
    findLiveByLauncher: (id) => (live[id] ? ({ id: live[id] } as any) : undefined),
    now: () => new Date('2026-09-30T10:00:00.000Z'),
  });
  return { svc, folder, config, get saved() { return saved; } };
}

test('add → list → resolveRun ready', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [], prompt: 'refresh dashboard' });
  assert.ok(v.ok);
  assert.deepEqual(await s.svc.add({ id: 'jarvar-refresh', label: 'JarvAR refresh', validated: v.value }), { ok: true });
  assert.equal((await s.svc.list())[0].agentCommand, 'claude');
  const r = await s.svc.resolveRun('jarvar-refresh');
  assert.equal(r.kind, 'ready');
});

test('add rejects bad id, worktree launchers, and duplicates unless overwrite', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  assert.equal((await s.svc.add({ id: 'Bad Id', label: 'x', validated: v.value })).ok, false);
  const wt = { ...v.value, request: { ...v.value.request, worktree: 'feat/x' } };
  assert.equal((await s.svc.add({ id: 'wt', label: 'x', validated: wt })).ok, false);
  assert.equal((await s.svc.add({ id: 'a', label: 'x', validated: v.value })).ok, true);
  assert.equal((await s.svc.add({ id: 'a', label: 'y', validated: v.value })).ok, false);
  assert.equal((await s.svc.add({ id: 'a', label: 'y', validated: v.value, overwrite: true })).ok, true);
  assert.equal((await s.svc.list())[0].label, 'y');
});

test('resolveRun: unknown, live, changed agent command, changed folder config, invalid folder', async (t) => {
  const s = setup(t, { live1: 'sess-1' });
  assert.equal((await s.svc.resolveRun('nope')).kind, 'unknown');
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  await s.svc.add({ id: 'live1', label: 'l', validated: v.value });
  assert.deepEqual(await s.svc.resolveRun('live1'), { kind: 'live', sessionId: 'sess-1' });

  await s.svc.add({ id: 'c1', label: 'c', validated: { ...v.value, agentCommand: 'claude-old' } });
  assert.equal((await s.svc.resolveRun('c1')).kind, 'changed');

  await s.svc.add({ id: 'c2', label: 'c', validated: v.value });
  mkdirSync(path.join(s.folder, '.claude'));
  const r = await s.svc.resolveRun('c2');
  assert.equal(r.kind, 'changed');
  assert.ok(r.kind === 'changed' && r.validated.warnings.some((w) => w.kind === 'launcher-changed'));

  rmSync(s.folder, { recursive: true, force: true });
  assert.equal((await s.svc.resolveRun('c2')).kind, 'invalid');
});

test('rename and remove', async (t) => {
  const s = setup(t);
  const v = await s.svc.validate({ agent: 'claude', folder: s.folder, flags: [] });
  assert.ok(v.ok);
  await s.svc.add({ id: 'a', label: 'x', validated: v.value });
  assert.deepEqual(await s.svc.rename('a', 'New name'), { ok: true });
  assert.equal((await s.svc.list())[0].label, 'New name');
  assert.equal((await s.svc.rename('a', '')).ok, false);
  assert.equal((await s.svc.rename('zz', 'x')).ok, false);
  assert.deepEqual(await s.svc.remove('a'), { ok: true });
  assert.deepEqual(await s.svc.list(), []);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && node --import tsx --test src/services/launch/LaunchService.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`server/src/services/launch/LaunchService.ts`:

```ts
import type { AppConfig, Launcher, LaunchActionResult, LaunchRequest, RunResolution, SessionInfo, ValidatedLaunch, ValidationResult } from '@argus/shared';
import type { AgentRegistry } from '../AgentRegistry.js';
import { validateLaunch } from './validateLaunch.js';

const ID_RE = /^[a-z0-9-]{1,40}$/;
const MAX_LABEL = 60;

export interface LaunchServiceDeps {
  store: { load(): Promise<Launcher[]>; save(l: Launcher[]): Promise<void> };
  loadConfig: () => Promise<AppConfig>;
  agentRegistry: AgentRegistry;
  home: string;
  findLiveByLauncher: (launcherId: string) => SessionInfo | undefined;
  now?: () => Date;
}

/** Deep-link launch logic shared by the Electron gate. No REST surface. */
export class LaunchService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  constructor(private deps: LaunchServiceDeps) {}

  async validate(req: LaunchRequest): Promise<ValidationResult> {
    return validateLaunch(req, { agentRegistry: this.deps.agentRegistry, config: await this.deps.loadConfig(), home: this.deps.home });
  }

  list(): Promise<Launcher[]> {
    return this.deps.store.load();
  }

  async resolveRun(launcherId: string): Promise<RunResolution> {
    const launcher = (await this.deps.store.load()).find((l) => l.id === launcherId);
    if (!launcher) return { kind: 'unknown' };
    const live = this.deps.findLiveByLauncher(launcherId);
    if (live) return { kind: 'live', sessionId: live.id };
    const v = await this.validate(launcher.request);
    if (!v.ok) return { kind: 'invalid', error: v.error };
    const reasons: string[] = [];
    if (v.value.agentCommand !== launcher.agentCommand) {
      reasons.push(`agent command changed (${launcher.agentCommand} → ${v.value.agentCommand})`);
    }
    const before = [...launcher.folderConfigAtSave].sort().join(',');
    const after = [...v.value.folderAgentConfig].sort().join(',');
    if (before !== after) reasons.push(`folder agent config changed (${before || 'none'} → ${after || 'none'})`);
    if (reasons.length) {
      const validated = { ...v.value, warnings: [...v.value.warnings, { kind: 'launcher-changed' as const, detail: `Since this launcher was saved: ${reasons.join('; ')}` }] };
      return { kind: 'changed', launcher, validated };
    }
    return { kind: 'ready', launcher, validated: v.value };
  }

  add(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult> {
    return this.serial(async () => {
      if (!ID_RE.test(input.id)) return { ok: false, error: 'Launcher id must be 1–40 chars of a-z, 0-9, -' };
      const label = input.label.trim();
      if (!label || label.length > MAX_LABEL) return { ok: false, error: `Label must be 1–${MAX_LABEL} characters` };
      if (input.validated.request.worktree) return { ok: false, error: 'A launcher can’t create a worktree (it would reuse the branch every run)' };
      const list = await this.deps.store.load();
      const exists = list.some((l) => l.id === input.id);
      if (exists && !input.overwrite) return { ok: false, error: `Launcher "${input.id}" already exists` };
      const { worktree: _w, base: _b, ...request } = input.validated.request;
      const launcher: Launcher = {
        id: input.id,
        label,
        request,
        agentCommand: input.validated.agentCommand,
        folderConfigAtSave: [...input.validated.folderAgentConfig],
        createdAt: (this.deps.now?.() ?? new Date()).toISOString(),
      };
      await this.deps.store.save(exists ? list.map((l) => (l.id === input.id ? launcher : l)) : [...list, launcher]);
      return { ok: true };
    });
  }

  rename(id: string, label: string): Promise<LaunchActionResult> {
    return this.serial(async () => {
      const clean = label.trim();
      if (!clean || clean.length > MAX_LABEL) return { ok: false, error: `Label must be 1–${MAX_LABEL} characters` };
      const list = await this.deps.store.load();
      if (!list.some((l) => l.id === id)) return { ok: false, error: 'No such launcher' };
      await this.deps.store.save(list.map((l) => (l.id === id ? { ...l, label: clean } : l)));
      return { ok: true };
    });
  }

  remove(id: string): Promise<LaunchActionResult> {
    return this.serial(async () => {
      const list = await this.deps.store.load();
      if (!list.some((l) => l.id === id)) return { ok: false, error: 'No such launcher' };
      await this.deps.store.save(list.filter((l) => l.id !== id));
      return { ok: true };
    });
  }

  /** Load-modify-save on one file: serialize so concurrent writes can't drop an entry. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.catch(() => {});
    return run;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && node --import tsx --test src/services/launch/LaunchService.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `server/src/index.ts`**

After `const windowRegistry = new WindowRegistry(windowStore);` (~L180), add:

```ts
// Deep-link launchers (argus://run/<id>) — own file, never via PUT /api/config.
const launcherStore = new LauncherStore(path.join(dataDir, 'launchers.json'));
const launchService = new LaunchService({
  store: launcherStore,
  loadConfig: () => configStore.load(),
  agentRegistry,
  home: os.homedir(),
  findLiveByLauncher: (id) => sessionManager.findLiveByLauncher(id),
});
/** In-process only (Electron main). There is deliberately no REST route. */
export function getLaunchService(): LaunchService {
  return launchService;
}
/** Create a session from an approved/ready launch and give it to `windowId`. */
export async function hostLaunch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<SessionInfo> {
  const r = v.request;
  const session = await sessionManager.createSession(
    r.folder, r.name, r.agent, r.flags, undefined, undefined, r.worktree, r.base, false, r.engine, r.mode, false,
    { initialPrompt: r.prompt, launcherId },
  );
  await windowRegistry.assign(session.id, windowId);
  return session;
}
let sessionsRestored: Promise<void> = Promise.resolve();
/** Resolves once restoreSessions (started in the background by startServer) settles. */
export function whenSessionsRestored(): Promise<void> {
  return sessionsRestored;
}
```

Imports to add at the top: `import os from 'os';` (if absent), `import { LauncherStore } from './persistence/LauncherStore.js';`, `import { LaunchService } from './services/launch/LaunchService.js';`, and `ValidatedLaunch, SessionInfo` in the existing `import type { … } from '@argus/shared'` (or a new `import type` line).

In `startServer()`, replace `void sessionManager\n    .restoreSessions()…catch(…);` with the same chain assigned to the promise:

```ts
  sessionsRestored = sessionManager
    .restoreSessions()
    .then(() =>
      windowRegistry.pruneToSessions(
        new Set(sessionManager.getAllSessions().map((s) => s.id)),
      ),
    )
    .catch((err) => {
      console.error('Failed to restore sessions:', err);
    });
```

`agentRegistry` is constructed at ~L150, before this block. Keep that order.

- [ ] **Step 6: Commit**

```bash
npm run verify
git add server/src/services/launch/LaunchService.ts server/src/services/launch/LaunchService.test.ts server/src/index.ts
git commit -m "feat(launch): LaunchService and in-process hostLaunch/whenSessionsRestored exports"
```

---

### Task 7: Electron launch gate (pure)

**Files:**
- Create: `electron/src/launchGate.ts`
- Test: `electron/src/launchGate.test.ts`

**Interfaces:**
- Consumes: `ParsedLink` (Task 2); shared types `LaunchRequest`, `ValidationResult`, `RunResolution`, `ValidatedLaunch`, `PendingLaunchView`, `SaveAsLauncher`, `LaunchActionResult`.
- Produces:

```ts
export interface GateDeps {
  now(): number;
  newId(): string;
  validate(req: LaunchRequest): Promise<ValidationResult>;
  resolveRun(id: string): Promise<RunResolution>;
  launch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<{ id: string }>;
  saveLauncher(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult>;
  targetWindow(): string;
  changed(windowId: string): void;
  toast(windowId: string, message: string, tone: 'ok' | 'warn' | 'danger'): void;
  highlight(windowId: string, sessionId: string): void;
  notifyIfBackground(view: PendingLaunchView, windowId: string): void;
}
export interface LaunchGate {
  handle(link: ParsedLink): Promise<void>;
  list(windowId: string): PendingLaunchView[];
  approve(id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult>;
  discard(id: string): void;
  tick(): void;
  has(id: string): boolean;
  windowOf(id: string): string | undefined;
  rehome(closedWindowId: string): void;
}
export function createLaunchGate(deps: GateDeps): LaunchGate;
export const LIMITS: { maxPending: 5; expiryMs: 600000; burstCount: 3; burstWindowMs: 10000; errorToastMs: 10000 };
```

- [ ] **Step 1: Failing tests**

`electron/src/launchGate.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLaunchGate, LIMITS, type GateDeps } from './launchGate.js';

const V = (over: any = {}) => ({
  request: { agent: 'claude', folder: '/tmp/p', flags: ['--model=opus'], prompt: 'hi', ...over.request },
  agentCommand: 'claude', args: ['--model=opus', 'hi'], command: 'claude --model=opus hi',
  warnings: over.warnings ?? [], folderAgentConfig: [],
});

function make(over: Partial<GateDeps> = {}) {
  let t = 1_000_000; let n = 0;
  const log: string[] = [];
  const deps: GateDeps = {
    now: () => t,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    validate: async (req) => ({ ok: true, value: V({ request: req }) as any }),
    resolveRun: async () => ({ kind: 'unknown' }),
    launch: async (_v, w, l) => { log.push(`launch:${w}:${l ?? ''}`); return { id: 'sess-new' }; },
    saveLauncher: async (i) => { log.push(`save:${i.id}`); return { ok: true }; },
    targetWindow: () => 'main',
    changed: (w) => log.push(`changed:${w}`),
    toast: (w, m, tone) => log.push(`toast:${w}:${tone}:${m}`),
    highlight: (w, s) => log.push(`highlight:${w}:${s}`),
    notifyIfBackground: (v) => log.push(`notify:${v.id}`),
    ...over,
  };
  const gate = createLaunchGate(deps);
  return { gate, log, advance: (ms: number) => { t += ms; } };
}
const newLink = (req: any = {}) => ({ ok: true as const, kind: 'new' as const, request: { agent: 'claude', folder: '/tmp/p', flags: [], ...req } });
const runLink = (id: string) => ({ ok: true as const, kind: 'run' as const, launcherId: id });

test('new link → pending card in the target window, never launched directly', async () => {
  const { gate, log } = make();
  await gate.handle(newLink());
  const [card] = gate.list('main');
  assert.equal(card.state, 'pending');
  assert.equal(card.source, 'new');
  assert.equal(card.canSaveAsLauncher, true);
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  assert.ok(log.includes('changed:main'));
  assert.ok(log.includes(`notify:${card.id}`));
});

test('identical new link while pending dedupes', async () => {
  const { gate } = make();
  await gate.handle(newLink({ prompt: 'x' }));
  await gate.handle(newLink({ prompt: 'x' }));
  assert.equal(gate.list('main').length, 1);
  await gate.handle(newLink({ prompt: 'y' }));
  assert.equal(gate.list('main').length, 2);
});

test('approve launches, removes the card, highlights; save-as stores a launcher', async () => {
  const { gate, log } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.deepEqual(await gate.approve(id, { id: 'my-launcher', label: 'Mine' }), { ok: true });
  assert.ok(log.includes('launch:main:my-launcher'));
  assert.ok(log.includes('save:my-launcher'));
  assert.ok(log.includes('highlight:main:sess-new'));
  assert.equal(gate.list('main').length, 0);
});

test('save-as is refused for worktree launches', async () => {
  const { gate } = make();
  await gate.handle(newLink({ worktree: 'feat/x' }));
  const card = gate.list('main')[0];
  assert.equal(card.canSaveAsLauncher, false);
  assert.equal((await gate.approve(card.id, { id: 'x', label: 'x' })).ok, false);
});

test('launch failure puts the card in error state; retry works', async () => {
  let fail = true;
  const { gate } = make({ launch: async () => { if (fail) throw new Error('boom'); return { id: 's' }; } });
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  assert.equal((await gate.approve(id)).ok, false);
  assert.equal(gate.list('main')[0].state, 'error');
  assert.equal(gate.list('main')[0].error, 'boom');
  fail = false;
  assert.deepEqual(await gate.approve(id), { ok: true });
});

test('invalid new link → error toast, no card; toasts throttled to one per 10 s', async () => {
  const { gate, log, advance } = make({ validate: async () => ({ ok: false, error: 'Folder does not exist' }) });
  await gate.handle(newLink());
  await gate.handle(newLink());
  assert.equal(log.filter((l) => l.startsWith('toast:')).length, 1);
  advance(LIMITS.errorToastMs + 1);
  await gate.handle(newLink());
  assert.ok(log.some((l) => l.includes('1 more invalid link ignored')));
  assert.equal(gate.list('main').length, 0);
});

test('parse errors toast the class only', async () => {
  const { gate, log } = make();
  await gate.handle({ ok: false, error: 'unknown-param' });
  assert.ok(log.some((l) => l.startsWith('toast:main:danger:') && l.includes('unknown-param')));
});

test('run: unknown → toast; live → highlight, no spawn; ready → direct launch + toast; changed → card', async () => {
  const launcher = { id: 'l1', label: 'L1', request: V().request, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '' };
  const res: Record<string, any> = {
    nope: { kind: 'unknown' },
    live: { kind: 'live', sessionId: 'sess-live' },
    ready: { kind: 'ready', launcher, validated: V() },
    changed: { kind: 'changed', launcher, validated: V({ warnings: [{ kind: 'launcher-changed', detail: 'x' }] }) },
    bad: { kind: 'invalid', error: 'Folder does not exist' },
  };
  const { gate, log, advance } = make({ resolveRun: async (id) => res[id] });
  await gate.handle(runLink('nope'));
  assert.ok(log.some((l) => l.includes('No launcher "nope"')));
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('live'));
  assert.ok(log.includes('highlight:main:sess-live'));
  assert.ok(!log.some((l) => l.startsWith('launch:')));
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('ready'));
  assert.ok(log.includes('launch:main:l1'));
  assert.ok(log.some((l) => l.startsWith('toast:main:ok:Started L1')));
  advance(LIMITS.burstWindowMs + 1);
  await gate.handle(runLink('changed'));
  const card = gate.list('main')[0];
  assert.equal(card.source, 'run');
  assert.equal(card.launcherId, 'l1');
  assert.equal(card.warnings[0].kind, 'launcher-changed');
});

test('cap of 5 pending; 6th → toast', async () => {
  const { gate, log, advance } = make();
  for (let i = 0; i < 6; i++) { await gate.handle(newLink({ prompt: `p${i}` })); advance(LIMITS.burstWindowMs); }
  assert.equal(gate.list('main').length, 5);
  assert.ok(log.some((l) => l.includes('Too many pending launches')));
});

test('burst: more than 3 links in 10 s are dropped', async () => {
  const { gate } = make();
  for (let i = 0; i < 5; i++) await gate.handle(newLink({ prompt: `b${i}` }));
  assert.equal(gate.list('main').length, 3);
});

test('expiry → expired state (kept until dismissed); approve refused', async () => {
  const { gate, advance } = make();
  await gate.handle(newLink());
  const id = gate.list('main')[0].id;
  advance(LIMITS.expiryMs + 1);
  gate.tick();
  assert.equal(gate.list('main')[0].state, 'expired');
  assert.equal((await gate.approve(id)).ok, false);
  gate.discard(id);
  assert.equal(gate.list('main').length, 0);
});

test('rehome moves cards of a closed window to main', async () => {
  const { gate } = make({ targetWindow: () => 'w2' });
  await gate.handle(newLink());
  const id = gate.list('w2')[0].id;
  gate.rehome('w2');
  assert.equal(gate.windowOf(id), 'main');
  assert.equal(gate.list('main').length, 1);
});

test('unknown id: approve refused, has() false', async () => {
  const { gate } = make();
  assert.equal(gate.has('nope'), false);
  assert.equal((await gate.approve('nope')).ok, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run build:electron && node --test electron/dist/launchGate.test.js`
Expected: build FAILS, module not found.

- [ ] **Step 3: Implement**

`electron/src/launchGate.ts`:

```ts
import type {
  LaunchActionResult, LaunchRequest, PendingLaunchView, RunResolution, SaveAsLauncher,
  ValidatedLaunch, ValidationResult,
} from '@argus/shared';
import type { ParsedLink } from './launchLink.js';

export const LIMITS = { maxPending: 5, expiryMs: 600_000, burstCount: 3, burstWindowMs: 10_000, errorToastMs: 10_000 } as const;

export interface GateDeps {
  now(): number;
  newId(): string;
  validate(req: LaunchRequest): Promise<ValidationResult>;
  resolveRun(id: string): Promise<RunResolution>;
  launch(v: ValidatedLaunch, windowId: string, launcherId?: string): Promise<{ id: string }>;
  saveLauncher(input: { id: string; label: string; validated: ValidatedLaunch; overwrite?: boolean }): Promise<LaunchActionResult>;
  targetWindow(): string;
  changed(windowId: string): void;
  toast(windowId: string, message: string, tone: 'ok' | 'warn' | 'danger'): void;
  highlight(windowId: string, sessionId: string): void;
  notifyIfBackground(view: PendingLaunchView, windowId: string): void;
}

export interface LaunchGate {
  handle(link: ParsedLink): Promise<void>;
  list(windowId: string): PendingLaunchView[];
  approve(id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult>;
  discard(id: string): void;
  tick(): void;
  has(id: string): boolean;
  windowOf(id: string): string | undefined;
  rehome(closedWindowId: string): void;
}

interface Entry { view: PendingLaunchView; validated: ValidatedLaunch; windowId: string; key: string }

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

export function createLaunchGate(deps: GateDeps): LaunchGate {
  const entries = new Map<string, Entry>();
  let recent: number[] = [];
  let lastErrorToast = -Infinity;
  let suppressedErrors = 0;

  const errorToast = (windowId: string, message: string) => {
    const t = deps.now();
    if (t - lastErrorToast < LIMITS.errorToastMs) { suppressedErrors++; return; }
    const extra = suppressedErrors ? ` (${suppressedErrors} more invalid link${suppressedErrors === 1 ? '' : 's'} ignored)` : '';
    suppressedErrors = 0;
    lastErrorToast = t;
    deps.toast(windowId, message + extra, 'danger');
  };

  const addCard = (validated: ValidatedLaunch, source: 'new' | 'run', launcherId?: string, label?: string): Entry | undefined => {
    const windowId = deps.targetWindow();
    const key = JSON.stringify([source, launcherId ?? '', validated.request]);
    for (const e of entries.values()) {
      if (e.key === key && e.view.state !== 'expired') { deps.changed(e.windowId); return e; }
    }
    if (entries.size >= LIMITS.maxPending) {
      deps.toast(windowId, 'Too many pending launches, link ignored', 'warn');
      return undefined;
    }
    const r = validated.request;
    const view: PendingLaunchView = {
      id: deps.newId(), source, launcherId,
      label: label ?? r.name ?? basename(r.folder),
      agent: r.agent, folder: r.folder, args: validated.args, prompt: r.prompt, command: validated.command,
      engine: r.engine, mode: r.mode, name: r.name, worktree: r.worktree, base: r.base,
      warnings: validated.warnings, state: 'pending', receivedAt: deps.now(),
      canSaveAsLauncher: source === 'new' && !r.worktree,
    };
    const entry: Entry = { view, validated, windowId, key };
    entries.set(view.id, entry);
    deps.changed(windowId);
    deps.notifyIfBackground(view, windowId);
    return entry;
  };

  const withinBurst = () => {
    const t = deps.now();
    recent = recent.filter((x) => t - x < LIMITS.burstWindowMs);
    if (recent.length >= LIMITS.burstCount) {
      console.warn('[launch] burst limit: link dropped');
      return false;
    }
    recent.push(t);
    return true;
  };

  return {
    async handle(link) {
      if (!withinBurst()) return;
      const w = deps.targetWindow();
      if (!link.ok) { errorToast(w, `Launch link rejected: ${link.error}`); return; }
      if (link.kind === 'notif') return; // main routes notif before calling the gate
      if (link.kind === 'new') {
        const v = await deps.validate(link.request);
        if (!v.ok) { errorToast(w, `Launch link rejected: ${v.error}`); return; }
        addCard(v.value, 'new');
        return;
      }
      const r = await deps.resolveRun(link.launcherId);
      switch (r.kind) {
        case 'unknown': errorToast(w, `No launcher "${link.launcherId}"`); return;
        case 'invalid': errorToast(w, `Launcher "${link.launcherId}": ${r.error}`); return;
        case 'live': deps.highlight(w, r.sessionId); return;
        case 'changed': addCard(r.validated, 'run', r.launcher.id, r.launcher.label); return;
        case 'ready':
          try {
            const s = await deps.launch(r.validated, w, r.launcher.id);
            deps.toast(w, `Started ${r.launcher.label}`, 'ok');
            deps.highlight(w, s.id);
          } catch (e) {
            const card = addCard(r.validated, 'run', r.launcher.id, r.launcher.label);
            if (card) { card.view.state = 'error'; card.view.error = (e as Error).message; deps.changed(card.windowId); }
          }
      }
    },

    list(windowId) {
      return [...entries.values()].filter((e) => e.windowId === windowId).map((e) => ({ ...e.view }));
    },

    async approve(id, saveAs) {
      const e = entries.get(id);
      if (!e) return { ok: false, error: 'No such pending launch' };
      if (e.view.state === 'expired') return { ok: false, error: 'This launch expired' };
      if (e.view.state === 'starting') return { ok: false, error: 'Already starting' };
      if (saveAs && !e.view.canSaveAsLauncher) return { ok: false, error: 'This launch can’t be saved as a launcher' };
      e.view.state = 'starting'; e.view.error = undefined; deps.changed(e.windowId);
      try {
        if (saveAs) {
          const saved = await deps.saveLauncher({ id: saveAs.id, label: saveAs.label, validated: e.validated, overwrite: saveAs.overwrite });
          if (!saved.ok) { e.view.state = 'pending'; e.view.error = saved.error; deps.changed(e.windowId); return saved; }
        }
        const launcherId = saveAs?.id ?? e.view.launcherId;
        const s = await deps.launch(e.validated, e.windowId, launcherId);
        entries.delete(id);
        deps.changed(e.windowId);
        deps.highlight(e.windowId, s.id);
        return { ok: true };
      } catch (err) {
        e.view.state = 'error'; e.view.error = (err as Error).message; deps.changed(e.windowId);
        return { ok: false, error: (err as Error).message };
      }
    },

    discard(id) {
      const e = entries.get(id);
      if (!e) return;
      entries.delete(id);
      deps.changed(e.windowId);
    },

    tick() {
      const t = deps.now();
      for (const e of entries.values()) {
        if (e.view.state === 'pending' && t - e.view.receivedAt > LIMITS.expiryMs) {
          e.view.state = 'expired';
          deps.changed(e.windowId);
        }
      }
    },

    has: (id) => entries.has(id),
    windowOf: (id) => entries.get(id)?.windowId,

    rehome(closed) {
      let moved = false;
      for (const e of entries.values()) if (e.windowId === closed) { e.windowId = 'main'; moved = true; }
      if (moved) deps.changed('main');
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run build:electron && node --test electron/dist/launchGate.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run verify
git add electron/src/launchGate.ts electron/src/launchGate.test.ts
git commit -m "feat(launch): pure approval gate (pending, run, dedupe, limits, expiry)"
```

---

### Task 8: Electron wiring (open-url, IPC, preload, menu, notification)

**Files:**
- Modify: `electron/src/window.ts` (add `windowIdOf`)
- Modify: `electron/src/main.ts` (open-url handler ~`:1284`; `main()` after `createAppWindow('main')` ~`:1233`; IPC handlers next to the others ~`:930`; menu item next to "New Session" ~`:578`; extract `postNotification` from the `notif:show` handler ~`:984`; secondary-close handler ~`:1205`)
- Modify: `electron/src/preload.ts` (add `electronLaunch` bridge; add `'menu:review-launch'` to `MENU_CHANNELS`)
- Modify: `client/src/utils/platform.ts` (`MenuChannel` + `ElectronLaunchBridge` typing)

**Interfaces:**
- Consumes: `parseLaunchUrl` (Task 2), `createLaunchGate` (Task 7), server exports `getLaunchService`, `hostLaunch`, `whenSessionsRestored` (Task 6).
- Produces (renderer bridge `window.electronLaunch`):

```ts
export interface ElectronLaunchBridge {
  list(): Promise<PendingLaunchView[]>;
  approve(id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult>;
  discard(id: string): Promise<void>;
  onChanged(cb: () => void): () => void;
  onToast(cb: (t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => void): () => void;
  launchers: {
    list(): Promise<Launcher[]>;
    rename(id: string, label: string): Promise<LaunchActionResult>;
    remove(id: string): Promise<LaunchActionResult>;
  };
}
```

IPC channels: `launch:list` · `launch:approve` · `launch:discard` · `launcher:list` · `launcher:rename` · `launcher:delete` (invoke); `launch:changed` · `launch:toast` · `menu:review-launch` (main → renderer).

- [ ] **Step 1: `windowIdOf` in `window.ts`**

```ts
/** Which Argus window owns this webContents (IPC sender check). null = not ours. */
export function windowIdOf(wc: Electron.WebContents): string | null {
  for (const [id, win] of windows) if (!win.isDestroyed() && win.webContents === wc) return id;
  return null;
}
```

Add `windowIdOf` and `getFocusedWindowId` to the `./window.js` import list in `main.ts` (`main.ts:16`).

- [ ] **Step 2: Extract `postNotification`**

In `main.ts`, move the body of `ipcMain.on('notif:show', (_event, payload) => { … })` into a module-level function:

```ts
type NotifPayload = { id: string; title: string; subtitle?: string; body: string; sound?: boolean; attributeToApp?: boolean };
function postNotification(payload: NotifPayload, onNativeClick?: () => void): void {
  /* the handler body, moved verbatim */
}
```

Make exactly one change inside the moved body: in the native `Notification` fallback branch (used when `terminalNotifierPath` is null), the `click` listener calls `onNativeClick()` when provided, else keeps its current behaviour. The handler becomes `ipcMain.on('notif:show', (_e, payload: NotifPayload) => postNotification(payload));`. The existing notification tests and a manual banner test from Settings → Notifications must behave as before.

- [ ] **Step 3: Gate + queue + open-url**

Module level (next to `terminalNotifierPath`):

```ts
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { parseLaunchUrl } from './launchLink.js';
import { createLaunchGate, type LaunchGate } from './launchGate.js';

// Deep-link launches (argus://new, argus://run). Links arriving before the main
// window has loaded AND session restore has settled are queued, then drained.
let launchGate: LaunchGate | null = null;
let launchReady = false;
const pendingLaunchUrls: string[] = [];

function handleLaunchUrl(url: string): void {
  const parsed = parseLaunchUrl(url, SCHEME, homedir());
  if (parsed.ok && parsed.kind === 'notif') {
    const w = launchGate?.windowOf(parsed.sessionId);
    if (w) focusAppWindow(w); else deliverNotifClick(parsed.sessionId);
    return;
  }
  if (!launchReady || !launchGate) {
    if (pendingLaunchUrls.length < 20) pendingLaunchUrls.push(url);
    return;
  }
  void launchGate.handle(parsed).catch((e) => console.error('[launch] handle failed:', e));
}
```

Replace the `open-url` body (`main.ts:1284-1288`) with:

```ts
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleLaunchUrl(url);
  });
```

`deliverNotifClick` still validates with `SESSION_ID_RE` internally via the parser's UUID check. Keep `SESSION_ID_RE` (the notifier still uses it).

- [ ] **Step 4: Build the gate in `main()` and drain when ready**

After the server exports are wired (after `getWindowRegistryStateFn = …`, ~L1196):

```ts
  const launchService = server.getLaunchService() as import('../../server/dist/services/launch/LaunchService.js').LaunchService;
  const hostLaunch = server.hostLaunch as (v: import('@argus/shared').ValidatedLaunch, windowId: string, launcherId?: string) => Promise<{ id: string }>;
  const sendTo = (windowId: string, channel: string, payload?: unknown) => {
    const win = getAppWindow(windowId) ?? getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  launchGate = createLaunchGate({
    now: () => Date.now(),
    newId: () => randomUUID(),
    validate: (req) => launchService.validate(req),
    resolveRun: (id) => launchService.resolveRun(id),
    launch: (v, w, l) => hostLaunch(v, w, l),
    saveLauncher: (i) => launchService.add(i),
    targetWindow: () => getFocusedWindowId(),
    changed: (w) => {
      const win = getAppWindow(w) ?? getMainWindow();
      if (win && !win.isVisible()) focusAppWindow(w);
      sendTo(w, 'launch:changed');
    },
    toast: (w, message, tone) => sendTo(w, 'launch:toast', { message, tone }),
    highlight: (w, sessionId) => { focusAppWindow(w); sendTo(w, 'notif:click', sessionId); },
    notifyIfBackground: (view, w) => {
      if (BrowserWindow.getFocusedWindow()) return;
      postNotification(
        { id: view.id, title: 'Launch waiting for approval', subtitle: view.label, body: `${view.agent} in ${view.folder}`, attributeToApp: true },
        () => focusAppWindow(w),
      );
    },
  });
  setInterval(() => launchGate?.tick(), 30_000).unref();
```

Check that `BrowserWindow` is imported from `electron` in `main.ts`; add it if not.

Update `setSecondaryCloseHandler((id) => { … })` to also call `launchGate?.rehome(id);` before the existing line.

After `createAppWindow('main')` and the secondary-window loop (~L1236):

```ts
  // Drain queued deep links once the main renderer has loaded and restore has
  // settled (so run/<id> focus-if-live sees restored sessions).
  const mainWin = getMainWindow();
  const rendererReady = new Promise<void>((resolve) => {
    if (!mainWin || !mainWin.webContents.isLoading()) resolve();
    else mainWin.webContents.once('did-finish-load', () => resolve());
  });
  const whenRestored = server.whenSessionsRestored as () => Promise<void>;
  void Promise.all([rendererReady, whenRestored()]).then(() => {
    launchReady = true;
    for (const u of pendingLaunchUrls.splice(0)) handleLaunchUrl(u);
  });
```

- [ ] **Step 5: IPC handlers with sender validation**

Next to the other `ipcMain.handle` calls:

```ts
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /** Only an Argus window's main frame may drive launches. Returns its window id. */
  const launchSender = (e: Electron.IpcMainInvokeEvent, requireFocus: boolean): string | null => {
    if (e.senderFrame !== e.sender.mainFrame) return null;
    const w = windowIdOf(e.sender);
    if (!w) return null;
    if (requireFocus && !getAppWindow(w)?.isFocused()) return null;
    return w;
  };
  const refused = { ok: false as const, error: 'Refused: not a focused Argus window' };

  ipcMain.handle('launch:list', (e) => {
    const w = launchSender(e, false);
    return w && launchGate ? launchGate.list(w) : [];
  });
  ipcMain.handle('launch:approve', (e, arg: { id: unknown; saveAs?: { id: unknown; label: unknown; overwrite?: unknown } }) => {
    if (!launchSender(e, true) || !launchGate) return refused;
    if (typeof arg?.id !== 'string' || !UUID_RE.test(arg.id)) return { ok: false, error: 'Bad id' };
    const s = arg.saveAs;
    const saveAs = s && typeof s.id === 'string' && typeof s.label === 'string'
      ? { id: s.id, label: s.label, overwrite: s.overwrite === true }
      : undefined;
    return launchGate.approve(arg.id, saveAs);
  });
  ipcMain.handle('launch:discard', (e, id: unknown) => {
    if (!launchSender(e, false) || typeof id !== 'string' || !UUID_RE.test(id)) return;
    launchGate?.discard(id);
  });
  ipcMain.handle('launcher:list', (e) => (launchSender(e, false) ? launchService.list() : []));
  ipcMain.handle('launcher:rename', (e, arg: { id: unknown; label: unknown }) => {
    if (!launchSender(e, true)) return refused;
    if (typeof arg?.id !== 'string' || typeof arg.label !== 'string') return { ok: false, error: 'Bad input' };
    return launchService.rename(arg.id, arg.label);
  });
  ipcMain.handle('launcher:delete', (e, id: unknown) => {
    if (!launchSender(e, true)) return refused;
    if (typeof id !== 'string') return { ok: false, error: 'Bad input' };
    return launchService.remove(id);
  });
```

These handlers reference `launchService`, so register them inside `main()` after Step 4's block. If the existing handlers live in a function that runs earlier, register these after the gate is created instead.

- [ ] **Step 6: Menu item**

In the menu template, right after "Close Session":

```ts
      {
        label: 'Review Pending Launch',
        accelerator: 'Alt+CmdOrCtrl+L',
        click: () => sendMenuEvent('menu:review-launch'),
      },
```

Check that ⌥⌘L is free: `grep -n "Alt+CmdOrCtrl+L\|alt+mod+l" electron/src client/src -r`. If taken, use `Alt+CmdOrCtrl+Shift+L` and update the Task 9 comment.

- [ ] **Step 7: Preload bridge**

In `preload.ts`, add `'menu:review-launch'` to `MENU_CHANNELS`, and append:

```ts
// Deep-link launch approvals. Approval/launcher writes are validated in main
// (sender must be a focused Argus window's main frame).
contextBridge.exposeInMainWorld('electronLaunch', {
  list: () => ipcRenderer.invoke('launch:list'),
  approve: (id: string, saveAs?: { id: string; label: string; overwrite?: boolean }) => ipcRenderer.invoke('launch:approve', { id, saveAs }),
  discard: (id: string) => ipcRenderer.invoke('launch:discard', id),
  onChanged: (cb: () => void) => {
    const l = () => cb();
    ipcRenderer.on('launch:changed', l);
    return () => ipcRenderer.off('launch:changed', l);
  },
  onToast: (cb: (t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => void) => {
    const l = (_e: unknown, t: { message: string; tone: 'ok' | 'warn' | 'danger' }) => cb(t);
    ipcRenderer.on('launch:toast', l);
    return () => ipcRenderer.off('launch:toast', l);
  },
  launchers: {
    list: () => ipcRenderer.invoke('launcher:list'),
    rename: (id: string, label: string) => ipcRenderer.invoke('launcher:rename', { id, label }),
    remove: (id: string) => ipcRenderer.invoke('launcher:delete', id),
  },
});
```

In `client/src/utils/platform.ts`, add `| 'menu:review-launch'` to `MenuChannel`, the `ElectronLaunchBridge` interface (from **Interfaces**, with `import type { Launcher, LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';`), and `electronLaunch?: ElectronLaunchBridge;` in the global `Window`.

- [ ] **Step 8: Build and smoke test**

```bash
npm run verify
npm run dev
# in another terminal:
mkdir -p /tmp/argus-dl-test
open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=hello"
```

Expected: in the dev app's DevTools console (renderer), `await window.electronLaunch.list()` returns one entry with `state: 'pending'` and a `folder-outside-roots` warning. (There's no UI until Task 9.) `await window.electronLaunch.approve(<id>)` from the console returns `{ok:false, error:'Refused…'}` only if the window is unfocused. With focus, a new tile runs `claude 'hello'`.

Cold start: quit the dev app, run `open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=cold"`, and wait for the dev app to launch. It won't launch on its own; the bare Electron limit applies (Task 1). So start `npm run dev` first, then click the link **during** its startup. `list()` must show the card once loaded.

- [ ] **Step 9: Commit**

```bash
git add electron/src/window.ts electron/src/main.ts electron/src/preload.ts client/src/utils/platform.ts
git commit -m "feat(launch): wire deep links, IPC with sender checks, notification, review menu item"
```

---

### Task 9: Approval card UI

**Files:**
- Create: `client/src/hooks/useLaunches.ts`
- Create: `client/src/app/ui/LaunchCardStack.tsx`
- Create: `client/src/app/ui/PendingLaunchCard.tsx`
- Test: `client/src/app/ui/PendingLaunchCard.test.tsx`
- Modify: `client/src/app/ArgusApp.tsx` (mount `<LaunchCardStack />` inside `<ToastProvider>`, next to other overlays; the toast subscription lives in the stack)

**Interfaces:**
- Consumes: `window.electronLaunch` (Task 8), `PendingLaunchView`, `SaveAsLauncher` (Task 2), `Button`, `Badge`, `pushToast` from `components/primitives`, `useOverlaySuppression` from `hooks/useOverlaySuppression.ts`.
- Produces: `useLaunches(): { pending: PendingLaunchView[]; approve(id, saveAs?): Promise<LaunchActionResult>; discard(id): Promise<void> }`; `<PendingLaunchCard view onApprove onDiscard index />`; `<LaunchCardStack />`.

- [ ] **Step 1: Failing card tests**

`client/src/app/ui/PendingLaunchCard.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PendingLaunchView } from '@argus/shared';
import { PendingLaunchCard, START_DELAY_MS } from './PendingLaunchCard.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const base: PendingLaunchView = {
  id: 'id-1', source: 'new', label: 'jarvar', agent: 'claude', folder: '/Users/me/development/jarvar',
  args: ['--model=opus', 'line1\nline2'], prompt: 'line1\nline2', command: "claude --model=opus 'line1\nline2'",
  warnings: [], state: 'pending', receivedAt: 0, canSaveAsLauncher: true,
};

let container: HTMLDivElement; let root: Root;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

async function render(view: Partial<PendingLaunchView> = {}, handlers: any = {}) {
  const onApprove = handlers.onApprove ?? vi.fn(async () => ({ ok: true }));
  const onDiscard = handlers.onDiscard ?? vi.fn(async () => {});
  await act(async () => { root.render(<PendingLaunchCard view={{ ...base, ...view }} index={handlers.index ?? 0} onApprove={onApprove} onDiscard={onDiscard} />); });
  return { onApprove, onDiscard };
}
const q = (sel: string) => container.querySelector(sel) as HTMLElement;
const start = () => q('[data-testid="launch-start"]') as HTMLButtonElement;

describe('PendingLaunchCard', () => {
  it('lists every argument on its own row and shows the prompt with visible newlines and a count', async () => {
    await render();
    const rows = container.querySelectorAll('[data-testid="launch-arg"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toBe('--model=opus');
    const prompt = q('[data-testid="launch-prompt"]');
    expect(prompt.textContent).toContain('⏎');
    expect(q('[data-testid="launch-prompt-count"]').textContent).toContain('11');
  });

  it('Start is aria-disabled for the delay, then enabled; never type=submit or autofocused', async () => {
    const { onApprove } = await render();
    expect(start().getAttribute('aria-disabled')).toBe('true');
    expect(start().type).toBe('button');
    expect(document.activeElement).not.toBe(start());
    await act(async () => { start().click(); });
    expect(onApprove).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    expect(start().getAttribute('aria-disabled')).toBe('false');
    await act(async () => { start().click(); });
    expect(onApprove).toHaveBeenCalledWith('id-1', undefined);
  });

  it('delay restarts when the card moves (index change) and on window focus', async () => {
    const h = { onApprove: vi.fn(async () => ({ ok: true })), onDiscard: vi.fn(), index: 0 };
    await render({}, h);
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    await render({}, { ...h, index: 1 });
    expect(start().getAttribute('aria-disabled')).toBe('true');
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(start().getAttribute('aria-disabled')).toBe('true');
  });

  it('Enter on the card does not approve; Esc on the card discards', async () => {
    const { onApprove, onDiscard } = await render();
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); });
    const card = q('[data-testid="launch-card"]');
    await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onApprove).not.toHaveBeenCalled();
    await act(async () => { card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onDiscard).toHaveBeenCalledWith('id-1');
  });

  it('warnings render as icon + text rows', async () => {
    await render({ warnings: [{ kind: 'folder-agent-config', detail: 'Loads when the agent starts: .claude' }] });
    const w = q('[data-testid="launch-warning"]');
    expect(w.textContent).toContain('Loads when the agent starts');
    expect(w.querySelector('svg')).not.toBeNull();
  });

  it('save-as-launcher passes id and label; disabled with helper text when not allowed', async () => {
    const { onApprove } = await render();
    await act(async () => { (q('[data-testid="launch-save-toggle"]') as HTMLInputElement).click(); });
    const id = q('[data-testid="launch-save-id"]') as HTMLInputElement;
    expect(id.value).toBe('jarvar');
    await act(async () => { vi.advanceTimersByTime(START_DELAY_MS); start().click(); });
    expect(onApprove).toHaveBeenCalledWith('id-1', { id: 'jarvar', label: 'jarvar' });

    await render({ canSaveAsLauncher: false, worktree: 'feat/x' });
    expect((q('[data-testid="launch-save-toggle"]') as HTMLInputElement).disabled).toBe(true);
    expect(container.textContent).toContain('would create the same branch every run');
  });

  it('states: starting, error with Retry, expired with Dismiss only', async () => {
    await render({ state: 'starting' });
    expect(container.textContent).toContain('Starting…');
    await render({ state: 'error', error: 'boom' });
    expect(container.textContent).toContain('boom');
    expect(container.textContent).toContain('Retry');
    await render({ state: 'expired' });
    expect(container.textContent).toContain('Expired');
    expect(q('[data-testid="launch-start"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w client -- src/app/ui/PendingLaunchCard.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `useLaunches`**

`client/src/hooks/useLaunches.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';

/** Pending deep-link launches for THIS window. State lives in Electron main;
 *  `launch:changed` is only a hint to re-read it (survives renderer reloads). */
export function useLaunches() {
  const bridge = typeof window !== 'undefined' ? window.electronLaunch : undefined;
  const [pending, setPending] = useState<PendingLaunchView[]>([]);
  const refresh = useCallback(() => { void bridge?.list().then(setPending).catch(() => {}); }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    refresh();
    return bridge.onChanged(refresh);
  }, [bridge, refresh]);

  const approve = useCallback(
    (id: string, saveAs?: SaveAsLauncher): Promise<LaunchActionResult> =>
      bridge ? bridge.approve(id, saveAs) : Promise.resolve({ ok: false, error: 'Unavailable' }),
    [bridge],
  );
  const discard = useCallback((id: string) => (bridge ? bridge.discard(id) : Promise.resolve()), [bridge]);
  return { pending, approve, discard };
}
```

- [ ] **Step 4: Implement `PendingLaunchCard`**

`client/src/app/ui/PendingLaunchCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { LaunchActionResult, PendingLaunchView, SaveAsLauncher } from '@argus/shared';
import { Button } from '../../components/primitives/index.js';

export const START_DELAY_MS = 1000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'launcher';

interface Props {
  view: PendingLaunchView;
  index: number;
  onApprove: (id: string, saveAs?: SaveAsLauncher) => Promise<LaunchActionResult>;
  onDiscard: (id: string) => Promise<void> | void;
}

export function PendingLaunchCard({ view, index, onApprove, onDiscard }: Props) {
  const [armed, setArmed] = useState(false);
  const [save, setSave] = useState(false);
  const [saveId, setSaveId] = useState(slug(view.name ?? view.label));
  const [saveLabel, setSaveLabel] = useState(view.name ?? view.label);
  const [showAll, setShowAll] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Start arms 1 s after the card appears, and re-arms whenever the card moves
  // or the window regains focus — so a click aimed elsewhere can't approve it.
  const rearm = () => {
    setArmed(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(true), START_DELAY_MS);
  };
  useEffect(() => { rearm(); return () => { if (timer.current) clearTimeout(timer.current); }; }, [index]);
  useEffect(() => {
    const onFocus = () => rearm();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const busy = view.state === 'starting';
  const expired = view.state === 'expired';
  const start = () => {
    if (!armed || busy || expired) return;
    void onApprove(view.id, save && view.canSaveAsLauncher ? { id: saveId, label: saveLabel } : undefined);
  };
  const promptLines = (view.prompt ?? '').split('\n');
  const longPrompt = promptLines.length > 6;

  return (
    <div
      data-testid="launch-card"
      role="group"
      aria-label={`Launch request: ${view.agent} in ${view.folder}`}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); void onDiscard(view.id); } }}
      style={{
        width: 460, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
        background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,.35)', opacity: expired ? 0.6 : 1,
      }}
    >
      <div style={{ padding: 'var(--s-3) var(--s-4)', overflowY: 'auto' }}>
        <div style={{ fontWeight: 600 }}>{view.agent} · {view.label}{view.source === 'run' && view.launcherId ? ` (launcher ${view.launcherId})` : ''}</div>
        <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)', wordBreak: 'break-all' }}>{view.folder}</div>
        <div style={{ fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
          {[view.engine && `engine ${view.engine}`, view.mode && `mode ${view.mode}`, view.name && `name ${view.name}`].filter(Boolean).join(' · ')}
        </div>

        {view.warnings.map((w) => (
          <div key={w.kind} data-testid="launch-warning" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 6, color: 'var(--warn, var(--fg-0))' }}>
            <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 'var(--t-xs)' }}>{w.detail}</span>
          </div>
        ))}

        <div style={{ marginTop: 'var(--s-3)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>Arguments (every one listed; you decide)</div>
        {view.args.length === 0 && <div style={{ fontSize: 'var(--t-xs)' }}>none</div>}
        {view.args.map((a, i) => (
          <div key={i} data-testid="launch-arg" className="mono" style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: '2px 0', borderBottom: '1px solid var(--line-1)' }}>{a}</div>
        ))}

        {view.prompt !== undefined && (
          <>
            <div style={{ marginTop: 'var(--s-3)', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>
              Prompt <span data-testid="launch-prompt-count">({view.prompt.length} chars)</span>
            </div>
            <div
              data-testid="launch-prompt"
              tabIndex={0}
              className="mono"
              style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: showAll ? 'none' : '7.5em', overflowY: 'auto', background: 'var(--bg-1)', padding: 6, borderRadius: 4 }}
            >
              {promptLines.map((l, i) => (<span key={i}>{l}{i < promptLines.length - 1 ? '⏎\n' : ''}</span>))}
            </div>
            {longPrompt && (
              <button type="button" onClick={() => setShowAll((v) => !v)} style={{ fontSize: 'var(--t-xs)', background: 'none', border: 0, color: 'var(--accent)', cursor: 'pointer', padding: 0 }}>
                {showAll ? 'Show less' : `Show all (${promptLines.length} lines)`}
              </button>
            )}
          </>
        )}

        <details style={{ marginTop: 'var(--s-2)' }}>
          <summary style={{ fontSize: 'var(--t-xs)', cursor: 'pointer' }}>Command</summary>
          <div className="mono" style={{ fontSize: 'var(--t-xs)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{view.command}</div>
        </details>

        {view.state === 'error' && <div role="alert" style={{ marginTop: 6, color: 'var(--danger, red)', fontSize: 'var(--t-xs)' }}>{view.error}</div>}
        {view.state === 'pending' && view.error && <div role="alert" style={{ marginTop: 6, color: 'var(--danger, red)', fontSize: 'var(--t-xs)' }}>{view.error}</div>}
      </div>

      <div style={{ borderTop: '1px solid var(--line-2)', padding: 'var(--s-3) var(--s-4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {view.source === 'new' && !expired && (
          <div style={{ fontSize: 'var(--t-xs)' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input data-testid="launch-save-toggle" type="checkbox" checked={save} disabled={!view.canSaveAsLauncher} onChange={(e) => setSave(e.target.checked)} />
              Save as launcher (one-click <span className="mono">run/&lt;id&gt;</span> link)
            </label>
            {!view.canSaveAsLauncher && <div style={{ color: 'var(--fg-3)' }}>Not available: a launcher would create the same branch every run.</div>}
            {save && view.canSaveAsLauncher && (
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input data-testid="launch-save-id" className="mono" value={saveId} onChange={(e) => setSaveId(e.target.value)} aria-label="Launcher id" style={{ flex: 1 }} />
                <input data-testid="launch-save-label" value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} aria-label="Launcher label" style={{ flex: 1 }} />
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={() => void onDiscard(view.id)}>{expired ? 'Dismiss' : 'Discard'}</Button>
          {expired ? (
            <span style={{ alignSelf: 'center', fontSize: 'var(--t-xs)', color: 'var(--fg-3)' }}>Expired</span>
          ) : (
            <button
              data-testid="launch-start"
              type="button"
              aria-disabled={!armed || busy}
              onClick={start}
              style={{
                position: 'relative', overflow: 'hidden', padding: '4px 14px', borderRadius: 6,
                border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)',
                cursor: armed && !busy ? 'pointer' : 'not-allowed', opacity: armed && !busy ? 1 : 0.6,
              }}
            >
              {busy ? 'Starting…' : view.state === 'error' ? 'Retry' : 'Start'}
              {!armed && !busy && (
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 0, height: 2, background: 'var(--accent)', animation: `launch-arm ${START_DELAY_MS}ms linear forwards` }} />
              )}
            </button>
          )}
        </div>
      </div>
      <style>{'@keyframes launch-arm { from { width: 0 } to { width: 100% } }'}</style>
    </div>
  );
}
```

The card deliberately uses a native `<button>` for Start (not `Button`). `Button` has no `aria-disabled` mode, and a `disabled` button drops out of the tab order, which the spec forbids.

- [ ] **Step 5: Run card tests to pass**

Run: `npm test -w client -- src/app/ui/PendingLaunchCard.test.tsx`
Expected: PASS.

If the CSP in `client/index.html` blocks the inline `<style>` element (`style-src` without `'unsafe-inline'`), move the keyframes into `client/src/tokens/tokens.css` and delete the `<style>` element. Check with `grep -n "style-src" client/index.html`.

- [ ] **Step 6: Implement the stack**

`client/src/app/ui/LaunchCardStack.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useLaunches } from '../../hooks/useLaunches.js';
import { useOverlaySuppression } from '../../hooks/useOverlaySuppression.js';
import { pushToast } from '../../components/primitives/index.js';
import { PendingLaunchCard } from './PendingLaunchCard.js';

/** Distance from the window top: clears the WindowChrome toolbar. */
const STACK_TOP = 64;
const MAX_VISIBLE = 2;

/** Hides native terminal overlays under the stack. Keyed by the parent on the
 *  visible layout, so it re-suppresses when the stack grows or shrinks. */
function SuppressUnder({ target }: { target: () => DOMRect | null }) {
  useOverlaySuppression(() => {
    const r = target();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  });
  return null;
}

export function LaunchCardStack() {
  const { pending, approve, discard } = useLaunches();
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => window.electronLaunch?.onToast((t) => pushToast(t.message, t.tone)), []);
  useEffect(() => window.electronApp?.onMenu('menu:review-launch', () => {
    ref.current?.querySelector<HTMLElement>('[data-testid="launch-prompt"], [data-testid="launch-card"] button')?.focus();
  }), []);

  if (pending.length === 0) return null;
  const visible = expanded ? pending : pending.slice(0, MAX_VISIBLE);
  const hidden = pending.length - visible.length;

  return (
    <div
      ref={ref}
      aria-live="assertive"
      aria-label="Pending launches"
      style={{ position: 'fixed', top: STACK_TOP, right: 16, zIndex: 'var(--z-pop)' as unknown as number, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <SuppressUnder key={`${visible.length}-${expanded}`} target={() => ref.current?.getBoundingClientRect() ?? null} />
      {visible.map((v, i) => (
        <PendingLaunchCard key={v.id} view={v} index={i} onApprove={approve} onDiscard={discard} />
      ))}
      {hidden > 0 && (
        <button type="button" onClick={() => setExpanded(true)} style={{ alignSelf: 'flex-end', fontSize: 'var(--t-xs)' }}>
          +{hidden} more
        </button>
      )}
    </div>
  );
}
```

New cards append at the bottom (the gate appends in arrival order), so existing buttons never shift. The overlay suppression contract test (`hooks/overlaySuppressionContract.test.ts`) scans for `--z-pop` and requires `useOverlaySuppression` in the same file. `LaunchCardStack.tsx` contains both.

- [ ] **Step 7: Mount**

In `ArgusApp.tsx`, import `LaunchCardStack` from `./ui/LaunchCardStack.js` and render `{window.electronLaunch && <LaunchCardStack />}` inside `<ToastProvider>`, right before its closing tag (~L1130). Mobile never has the bridge, so nothing renders there.

- [ ] **Step 8: Verify and commit**

```bash
npm run verify
npm run dev   # then: open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=hello%0Aworld"
```

Manual checks:
- The card appears top-right below the toolbar, over a native-engine tile, and that tile hides while the card shows.
- Start arms after 1 s.
- ⌥⌘L focuses the prompt.
- Esc discards.
- Save as launcher `test-hello` → a new tile runs. Then `open argus-dev://run/test-hello` while it runs → the tile is focused, no second tile.

```bash
git add client/src/hooks/useLaunches.ts client/src/app/ui/LaunchCardStack.tsx client/src/app/ui/PendingLaunchCard.tsx client/src/app/ui/PendingLaunchCard.test.tsx client/src/app/ArgusApp.tsx
git commit -m "feat(launch): approval card stack with states, delay, keyboard access, save-as-launcher"
```

---

### Task 10: Settings pane "Launchers"

**Files:**
- Create: `client/src/app/overlays/settings/panes/LaunchersPane.tsx`
- Test: `client/src/app/overlays/settings/panes/LaunchersPane.test.tsx`
- Modify: `client/src/app/overlays/settings/registry.ts` (`PaneId`, `PANES` entry)
- Modify: `client/src/app/overlays/SettingsOverlay.tsx` (import + `{pane === 'launchers' && <LaunchersPane {...paneProps} />}` next to `:155`)

**Interfaces:**
- Consumes: `window.electronLaunch.launchers` (Task 8), `PaneProps` (`settings/types.ts`), `Section`, `SettingRow`, `TextInput`, `Button`, `EmptyState`, `pushToast` primitives, `Launcher` type.
- Produces: `LaunchersPane({ config, onSave }: PaneProps)`.

- [ ] **Step 1: Failing tests**

`client/src/app/overlays/settings/panes/LaunchersPane.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '@argus/shared';
import { LaunchersPane } from './LaunchersPane.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

const L = { id: 'jarvar-refresh', label: 'JarvAR refresh', request: { agent: 'claude', folder: '/Users/me/development/jarvar', flags: ['--model=opus'], prompt: 'refresh dashboard' }, agentCommand: 'claude', folderConfigAtSave: [], createdAt: '2026-09-30T10:00:00.000Z' };
let container: HTMLDivElement; let root: Root;
let bridge: any;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  bridge = { list: vi.fn(async () => [L]), rename: vi.fn(async () => ({ ok: true })), remove: vi.fn(async () => ({ ok: true })) };
  (window as any).electronLaunch = { launchers: bridge };
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); delete (window as any).electronLaunch; });

async function render(onSave = vi.fn(async (p: any) => ({ ...DEFAULT_CONFIG, ...p }))) {
  await act(async () => { root.render(<LaunchersPane config={{ ...DEFAULT_CONFIG }} onSave={onSave} />); await Promise.resolve(); });
  return { onSave };
}

describe('LaunchersPane', () => {
  it('empty state', async () => {
    bridge.list.mockResolvedValueOnce([]);
    await render();
    expect(container.textContent).toContain('No launchers');
  });

  it('row shows label, run link, agent @ folder; expand shows args and prompt', async () => {
    await render();
    expect(container.textContent).toContain('JarvAR refresh');
    expect(container.textContent).toMatch(/argus(-dev)?:\/\/run\/jarvar-refresh/);
    expect(container.textContent).toContain('claude @ jarvar');
    await act(async () => { (container.querySelector('[data-testid="launcher-expand"]') as HTMLElement).click(); });
    expect(container.textContent).toContain('--model=opus');
    expect(container.textContent).toContain('refresh dashboard');
  });

  it('rename is inline (Electron has no window.prompt) and goes over the bridge', async () => {
    await render();
    await act(async () => { (container.querySelector('[data-testid="launcher-rename"]') as HTMLElement).click(); });
    const input = container.querySelector('[data-testid="launcher-rename-input"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Refresh JarvAR');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { (container.querySelector('[data-testid="launcher-rename-save"]') as HTMLElement).click(); await Promise.resolve(); });
    expect(bridge.rename).toHaveBeenCalledWith('jarvar-refresh', 'Refresh JarvAR');
  });

  it('delete goes over the bridge and refreshes', async () => {
    await render();
    bridge.list.mockResolvedValueOnce([]);
    await act(async () => { (container.querySelector('[data-testid="launcher-delete"]') as HTMLElement).click(); await Promise.resolve(); });
    expect(bridge.remove).toHaveBeenCalledWith('jarvar-refresh');
    expect(container.textContent).toContain('No launchers');
  });

  it('roots editor saves one root per line', async () => {
    const { onSave } = await render();
    const ta = container.querySelector('[data-testid="launch-roots"]') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, '~/development\n~/work\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // React's onBlur listens to focusout
    });
    expect(onSave).toHaveBeenCalledWith({ launchFolderRoots: ['~/development', '~/work'] });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w client -- src/app/overlays/settings/panes/LaunchersPane.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`client/src/app/overlays/settings/panes/LaunchersPane.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import type { Launcher } from '@argus/shared';
import { Button, Section, SettingRow, pushToast } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';

const scheme = () => (import.meta.env.DEV ? 'argus-dev' : 'argus');
const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const EXAMPLE = () => `${scheme()}://new?agent=claude&folder=~/development/my-repo&prompt=hello`;

export function LaunchersPane({ config, onSave }: PaneProps) {
  const bridge = window.electronLaunch?.launchers;
  const [list, setList] = useState<Launcher[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [roots, setRoots] = useState((config.launchFolderRoots ?? []).join('\n'));
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
  const refresh = useCallback(() => { void bridge?.list().then(setList); }, [bridge]);
  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (l: Launcher) => {
    const r = await bridge!.remove(l.id);
    if (!r.ok) { pushToast(r.error, 'danger'); return; }
    pushToast(`Deleted ${l.label}`, 'ok');
    refresh();
  };
  // Inline edit: Electron does not implement window.prompt().
  const saveRename = async () => {
    if (!editing) return;
    const r = await bridge!.rename(editing.id, editing.draft);
    if (!r.ok) { pushToast(r.error, 'danger'); return; }
    setEditing(null);
    refresh();
  };
  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => pushToast('Link copied', 'ok')); };

  return (
    <>
      <Section title="Launchers">
        {!bridge && <div className="setting-row"><div className="setting-row-hint">Launchers are available in the desktop app.</div></div>}
        {bridge && list?.length === 0 && (
          <div className="setting-row"><div className="setting-row-hint">No launchers. Approve a launch link and choose Save as launcher.</div></div>
        )}
        {list?.map((l) => (
          <div key={l.id} className="setting-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                {editing?.id === l.id ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input data-testid="launcher-rename-input" value={editing.draft} onChange={(e) => setEditing({ id: l.id, draft: e.target.value })} aria-label="Launcher label" />
                    <span data-testid="launcher-rename-save" onClick={() => void saveRename()}><Button size="sm">Save</Button></span>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="setting-row-label">{l.label}</div>
                )}
                <div className="setting-row-hint mono">{scheme()}://run/{l.id}</div>
                <div className="setting-row-hint">{l.request.agent} @ {base(l.request.folder)} · {new Date(l.createdAt).toLocaleDateString()}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => copy(`${scheme()}://run/${l.id}`)}>Copy link</Button>
              <span data-testid="launcher-rename" onClick={() => setEditing({ id: l.id, draft: l.label })}><Button size="sm" variant="ghost">Rename</Button></span>
              <span data-testid="launcher-delete" onClick={() => void remove(l)}><Button size="sm" variant="ghost" danger>Delete</Button></span>
              <span data-testid="launcher-expand" onClick={() => setOpen(open === l.id ? null : l.id)}><Button size="sm" variant="ghost">{open === l.id ? 'Hide' : 'Details'}</Button></span>
            </div>
            {open === l.id && (
              <div className="mono" style={{ fontSize: 'var(--t-xs)', marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                <div>folder: {l.request.folder}</div>
                <div>command: {l.agentCommand}</div>
                {l.request.flags.map((f, i) => <div key={i}>arg: {f}</div>)}
                {l.request.prompt !== undefined && <div>prompt: {l.request.prompt}</div>}
              </div>
            )}
          </div>
        ))}
      </Section>
      <Section title="Launch links">
        <SettingRow label="Folder roots" hint="One per line. Links to folders outside these get a warning on the approval card (never blocked).">
          <textarea
            data-testid="launch-roots"
            className="mono"
            rows={3}
            value={roots}
            onChange={(e) => setRoots(e.target.value)}
            onBlur={() => void onSave({ launchFolderRoots: roots.split('\n').map((r) => r.trim()).filter(Boolean) })}
          />
        </SettingRow>
        <SettingRow label="Link format" hint="Every argus://new link opens an approval card.">
          <Button size="sm" variant="ghost" onClick={() => copy(EXAMPLE())}>Copy example link</Button>
        </SettingRow>
      </Section>
    </>
  );
}
```

Spec deviation 4 applies to "undo toast": the toast confirms the delete but has no undo action. If Antonio wants undo, it needs a toast-with-action primitive, which is out of scope.

- [ ] **Step 4: Register the pane**

In `registry.ts`:
- add `| 'launchers'` to `PaneId`
- import `Rocket` from `lucide-react`
- insert after the `isolation` entry:

```ts
  {
    id: 'launchers',
    label: 'Launchers',
    group: 'Workspace',
    icon: Rocket,
    keys: ['launchFolderRoots'],
    keywords: ['launcher', 'deep link', 'argus://', 'url', 'link', 'run', 'jarvar', 'dashboard', 'approve', 'roots'],
  },
```

In `SettingsOverlay.tsx`, add `import { LaunchersPane } from './settings/panes/LaunchersPane.js';` and `{pane === 'launchers' && <LaunchersPane {...paneProps} />}` beside the other panes.

- [ ] **Step 5: Run to pass and commit**

Run: `npm test -w client -- src/app/overlays/settings/panes/LaunchersPane.test.tsx src/app/overlays/SettingsOverlay.test.tsx`
Expected: PASS.

```bash
npm run verify
git add client/src/app/overlays/settings/panes/LaunchersPane.tsx client/src/app/overlays/settings/panes/LaunchersPane.test.tsx client/src/app/overlays/settings/registry.ts client/src/app/overlays/SettingsOverlay.tsx
git commit -m "feat(launch): Launchers settings pane and folder roots"
```

---

### Task 11: Spec sync, docs, full end-to-end

**Files:**
- Modify: `docs/superpowers/specs/2026-09-30-deep-link-launcher-design.md` (apply the five deviations)
- Modify: `README.md` (Features: "Launch links")
- Modify: `CLAUDE.md` (Key Details: one bullet on `argus://new` / `run`, the in-process-only launch path, `launchers.json`)

- [ ] **Step 1: Spec sync**

In the spec:
- §5: replace `AppConfig.launchers` + the PUT carry-forward bullets with "Launchers live in `server/data/launchers.json` (`LauncherStore`); `PUT /api/config` never sees them".
- §4: "Review pending launch" is the app-menu item ⌥⌘L; toasts have no action buttons; the stack sits at `--z-pop` under sheets.
- §3: drop the dock badge.
- Testing table: the "Launcher store" row now reads "load/save round-trip, malformed entries dropped, config PUT never touches launchers".

- [ ] **Step 2: Docs**

`README.md`, under Features:

```markdown
### Launch links

Other local tools can open a session in Argus with a link. `argus://new?agent=claude&folder=~/dev/repo&prompt=…` always shows an approval card listing every argument; nothing runs until you click Start. Tick **Save as launcher** to get a one-click `argus://run/<id>` link (manage them in Settings → Launchers). A saved launcher re-checks its agent command and the folder's agent config on every run.
```

`CLAUDE.md` Key Details, one bullet:

```markdown
- Deep links: `open-url` routes `notif/`, `new?…` and `run/<id>` through `electron/src/launchLink.ts` (parser) and `electron/src/launchGate.ts` (approval gate). Launch creation is in-process only (`server/src/index.ts` `hostLaunch`, `getLaunchService`); there is deliberately no REST route. Launchers persist in `server/data/launchers.json`, never in `config.json`.
```

- [ ] **Step 3: Full manual end-to-end (dev)**

With `npm run dev` running:
1. `open "argus-dev://new?agent=claude&folder=/tmp/argus-dl-test&prompt=hello"` → card with a folder-outside-roots warning → Start → tile runs `claude 'hello'`.
2. Same link, approve with Save as launcher `test-hello` → tile.
3. `open argus-dev://run/test-hello` while it runs → focuses the tile, no new tile.
4. Exit that session. `open argus-dev://run/test-hello` → new tile, toast "Started test-hello".
5. `mkdir /tmp/argus-dl-test/.claude` → `open argus-dev://run/test-hello` → card with `launcher-changed`.
6. `open "argus-dev://new?agent=claude&folder=/tmp&prompt=--help"` → error toast "bad-prompt", no card.
7. Quit dev. Start `npm run dev` and click link 1 during startup → the card appears after load.
8. With Argus in the background (another app focused): click link 1 → system notification; clicking it focuses the card window.
9. Settings → Launchers: rename, copy link, delete; roots edit persists after reopening Settings; an unrelated Settings change leaves the launchers intact.

- [ ] **Step 4: Verify and commit**

```bash
npm run verify
git add docs/superpowers/specs/2026-09-30-deep-link-launcher-design.md README.md CLAUDE.md
git commit -m "docs(launch): sync spec with implementation, document launch links"
```

Stop here. Version bump and release (0.25.0) happen only when Antonio asks (CLAUDE.md release steps).
