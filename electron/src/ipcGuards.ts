/**
 * Sender + payload guards for renderer → main IPC.
 *
 * Every Argus window loads http://127.0.0.1:<port>, but ipcMain accepts a
 * message from ANY frame of ANY webContents: a subframe, a page a renderer bug
 * navigated to, or a webContents some future feature opens. Several handlers
 * (native-term:*, dialog:showMessageBox, menu:set-shortcuts, app:relaunch) also
 * trusted their payload's shape outright. These helpers are pure (no electron
 * import) so they are unit-tested directly; main.ts wires them in.
 */

import { isMainCommandId, type MainCommandId } from './menuModel.js';

/** The subset of an IpcMainEvent / IpcMainInvokeEvent the sender check reads. */
export interface IpcSenderLike {
  senderFrame?: { url: string } | null;
  sender: { mainFrame: unknown };
}

/** Our renderer origin. Mirrors window.ts (`ARGUS_PORT || '5757'`). */
export function appOrigin(port: string | undefined = process.env.ARGUS_PORT): string {
  return `http://127.0.0.1:${port || '5757'}`;
}

/** True only for the main frame of a page served from `origin`. */
export function isTrustedSender(e: IpcSenderLike, origin: string): boolean {
  const frame = e.senderFrame;
  if (!frame || frame !== e.sender.mainFrame) return false;
  try {
    return new URL(frame.url).origin === origin;
  } catch {
    return false;
  }
}

export const isSessionId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v);

const finite = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export interface Rect { x: number; y: number; width: number; height: number }

/** Window-relative CSS-pixel rect; generous bounds, but no NaN/Infinity/giant values. */
export function isRect(v: unknown): v is Rect {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  const LIM = 100_000;
  return finite(r.x, -LIM, LIM) && finite(r.y, -LIM, LIM) && finite(r.width, 0, LIM) && finite(r.height, 0, LIM);
}

export const isFontPx = (v: unknown): v is number => finite(v, 4, 200);

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** The message-box fields the renderer may set (client/src/utils/nativeDialog.ts). */
export interface SafeMessageBoxOptions {
  type?: 'none' | 'info' | 'error' | 'question' | 'warning';
  message: string;
  detail?: string;
  title?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

const BOX_TYPES = new Set(['none', 'info', 'error', 'question', 'warning']);
const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * Whitelist a renderer-supplied MessageBoxOptions. Everything else Electron
 * accepts (icon file paths, `signal`, textWidth, noLink…) is dropped. Returns
 * null when the required fields are malformed.
 */
export function sanitizeMessageBoxOptions(v: unknown): SafeMessageBoxOptions | null {
  if (!isPlainObject(v)) return null;
  if (!shortText(v.message, 10_000) || !v.message) return null;
  const buttons = v.buttons === undefined ? ['OK'] : v.buttons;
  if (!Array.isArray(buttons) || buttons.length === 0 || buttons.length > 8 || !buttons.every((b) => shortText(b, 200))) return null;
  const out: SafeMessageBoxOptions = { message: v.message, buttons: buttons as string[] };
  if (typeof v.type === 'string' && BOX_TYPES.has(v.type)) out.type = v.type as SafeMessageBoxOptions['type'];
  if (shortText(v.detail, 10_000)) out.detail = v.detail;
  if (shortText(v.title, 500)) out.title = v.title;
  const idx = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < out.buttons.length;
  if (idx(v.defaultId)) out.defaultId = v.defaultId as number;
  if (idx(v.cancelId)) out.cancelId = v.cancelId as number;
  if (shortText(v.checkboxLabel, 500)) out.checkboxLabel = v.checkboxLabel;
  if (typeof v.checkboxChecked === 'boolean') out.checkboxChecked = v.checkboxChecked;
  return out;
}

/** `menu:set-shortcuts` payload: a small string→string map, else null. */
export function sanitizeShortcuts(v: unknown): Record<string, string> | null {
  if (!isPlainObject(v)) return null;
  const entries = Object.entries(v);
  if (entries.length > 200) return null;
  const out: Record<string, string> = {};
  for (const [k, val] of entries) {
    if (k.length > 100 || !shortText(val, 100)) return null;
    out[k] = val;
  }
  return out;
}

/** Shape of an app-menu command id (menuModel.ts). The preload repeats this regex. */
export const isMenuCommandId = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 64 && /^menu:[a-z]+(-[a-z]+)*$/.test(v);

/**
 * `menu:invoke` gate: the main-run command a renderer may trigger, or null.
 * Only a trusted sender, and only an id on the static main-run allowlist —
 * a renderer-run id never loops back through main.
 */
export function menuInvokeTarget(e: IpcSenderLike, raw: unknown, origin: string): MainCommandId | null {
  if (!isTrustedSender(e, origin) || !isMenuCommandId(raw)) return null;
  return isMainCommandId(raw) ? raw : null;
}

/** Largest settings file main writes or reads (the renderer's parser caps it too). */
export const SETTINGS_PAYLOAD_MAX_BYTES = 1_000_000;
/** Longest launcher list one `launcher:import` may carry. */
export const LAUNCHER_IMPORT_MAX = 100;

/** `settings:save-file` / `settings:backup` payload: a JSON string of at most 1 MB. */
export function isSettingsPayload(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= SETTINGS_PAYLOAD_MAX_BYTES;
}

export interface LauncherImportItem {
  id: string;
  label: string;
  request: {
    agent: string;
    folder: string;
    flags: string[];
    prompt?: string;
    engine?: 'web' | 'native';
    mode?: 'persistent' | 'direct';
    name?: string;
  };
  overwrite: boolean;
}

const optText = (v: unknown, max: number) => v === undefined || shortText(v, max);

/**
 * One `launcher:import` entry, shape only: the request is validated for real
 * (agent, folder, flags) by LaunchService.validate before anything is saved.
 * Worktree fields are refused — a launcher can't create a worktree.
 */
export function isLauncherImportItem(v: unknown): v is LauncherImportItem {
  if (!isPlainObject(v) || !isPlainObject(v.request)) return false;
  const r = v.request;
  return typeof v.id === 'string' && /^[a-z0-9-]{1,40}$/.test(v.id)
    && shortText(v.label, 60) && v.label.trim().length > 0
    && typeof v.overwrite === 'boolean'
    && shortText(r.agent, 64) && shortText(r.folder, 4096)
    && Array.isArray(r.flags) && r.flags.length <= 64 && r.flags.every((f) => shortText(f, 512))
    && optText(r.prompt, 8000) && optText(r.name, 200)
    && (r.engine === undefined || r.engine === 'web' || r.engine === 'native')
    && (r.mode === undefined || r.mode === 'persistent' || r.mode === 'direct')
    && r.worktree === undefined && r.base === undefined;
}

/** `launcher:import` payload: 1–100 well-formed entries with distinct ids, else null. */
export function sanitizeLauncherImport(v: unknown): LauncherImportItem[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > LAUNCHER_IMPORT_MAX) return null;
  if (!v.every(isLauncherImportItem)) return null;
  if (new Set(v.map((i) => i.id)).size !== v.length) return null;
  return v.map((i) => ({
    id: i.id,
    label: i.label,
    overwrite: i.overwrite,
    request: {
      agent: i.request.agent,
      folder: i.request.folder,
      flags: [...i.request.flags],
      ...(i.request.prompt !== undefined ? { prompt: i.request.prompt } : {}),
      ...(i.request.engine !== undefined ? { engine: i.request.engine } : {}),
      ...(i.request.mode !== undefined ? { mode: i.request.mode } : {}),
      ...(i.request.name !== undefined ? { name: i.request.name } : {}),
    },
  }));
}
