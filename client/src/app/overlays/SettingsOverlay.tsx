import { useState, Fragment } from 'react';
import type { AppConfig, AgentDefinition, AgentFlag, NgrokStatus, SessionInfo } from '@argus/shared';
import { SlidersHorizontal, Cpu, Bell, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Flag, Wifi, WifiOff, Copy, Check, AlertTriangle, ExternalLink, GitBranch, Volume2, Timer, Keyboard, Minus, Maximize2, CircleX } from 'lucide-react';
import { api } from '../../services/api.js';
import { QRCodeSVG } from 'qrcode.react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { useTheme } from '../../context/theme-context.js';
import type { ThemeMode } from '../../context/theme-context.js';
import {
  Sheet,
  Section,
  Field,
  SettingRow,
  Chip,
  Toggle,
  IconButton,
  Button,
  TextInput,
  StatusDot,
  AlertSheet,
  PasswordFields,
  NGROK_PW_MIN,
  isNgrokPasswordValid,
} from '../../components/primitives/index.js';
import { KeyboardSettings } from './settings/KeyboardSettings.js';
import { QuickActionPreview } from './QuickActionSheet.js';
import { QuickActionPicker } from '../ui/QuickActionPicker.js';
import { WaitingStylePreview } from '../ui/WaitingStylePreview.js';
import { DEFAULT_TILE_QUICK_ACTION } from '../../constants/tileActions.js';
import { showNativeMessageBox } from '../../utils/nativeDialog.js';

interface SettingsOverlayProps {
  config: AppConfig;
  sessions?: SessionInfo[];
  onClose: () => void;
  onSave: (data: Partial<AppConfig>) => Promise<AppConfig>;
  onSaveFlag: (agentId: string, flag: AgentFlag) => Promise<void>;
  onDeleteFlag: (agentId: string, flagId: string) => Promise<void>;
  ngrokStatus: NgrokStatus | null;
  ngrokLoading: boolean;
  ngrokError: string | null;
  onNgrokStart: (password: string) => void;
  onNgrokStop: () => void;
  initialTab?: string;
}

type Tab = 'general' | 'agents' | 'notif' | 'remote' | 'worktrees' | 'keyboard';

const TABS: { id: Tab; icon: typeof Cpu; label: string }[] = [
  { id: 'general', icon: SlidersHorizontal, label: 'General' },
  { id: 'agents', icon: Cpu, label: 'Agents' },
  { id: 'notif', icon: Bell, label: 'Notifications' },
  { id: 'keyboard', icon: Keyboard, label: 'Keyboard' },
  { id: 'remote', icon: Wifi, label: 'Remote' },
  { id: 'worktrees', icon: GitBranch, label: 'Agent Isolation' },
];

const BUILTIN: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];

// Font-size presets (px). Defaults (Medium) match ConfigStore: code 13 / ui 14.
const DEFAULT_CODE_FONT_PX = 13;
const DEFAULT_UI_FONT_PX = 14;
const CODE_FONT_PRESETS = [
  { label: 'Small', px: 11 },
  { label: 'Medium', px: 13 },
  { label: 'Large', px: 15 },
  { label: 'X-Large', px: 17 },
];
const UI_FONT_PRESETS = [
  { label: 'Small', px: 12 },
  { label: 'Medium', px: 14 },
  { label: 'Large', px: 16 },
  { label: 'X-Large', px: 18 },
];

function FontSizeSelect({
  presets,
  value,
  defaultPx,
  onChange,
}: {
  presets: { label: string; px: number }[];
  value: number | undefined;
  defaultPx: number;
  onChange: (px: number) => void;
}) {
  // Snap an unknown stored value to the default preset so the control always reflects state.
  const current = presets.some((p) => p.px === value) ? (value as number) : defaultPx;
  return (
    <select
      value={current}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        appearance: 'none',
        width: '100%',
        height: 32,
        padding: '0 var(--s-2)',
        background: 'var(--bg-1)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-2)',
        color: 'var(--fg-0)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--t-sm)',
        cursor: 'pointer',
      }}
    >
      {presets.map((p) => (
        <option key={p.px} value={p.px}>{p.px === defaultPx ? `${p.label} (Default)` : p.label}</option>
      ))}
    </select>
  );
}

const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;
// Mirrors the server guard (config.ts) — custom agent commands are shell-spawned.
const COMMAND_PATTERN = /^[a-zA-Z0-9_@./\- ]+$/;

export function SettingsOverlay({ config, sessions = [], onClose, onSave, onSaveFlag, onDeleteFlag, ngrokStatus, ngrokLoading, ngrokError, onNgrokStart, onNgrokStop, initialTab }: SettingsOverlayProps) {
  const validInitial = (initialTab && ['general', 'agents', 'notif', 'remote', 'worktrees', 'keyboard'].includes(initialTab)) ? initialTab as Tab : 'general';
  const [tab, setTab] = useState<Tab>(validInitial);
  const { mode, setMode } = useTheme();
  const agents = [...BUILTIN, ...config.customAgents];

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [flagInput, setFlagInput] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);

  const [othersNameDraft, setOthersNameDraft] = useState(config.othersFolderName ?? 'Others');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = ngrokStatus?.tunnelStatus === 'connected';
  const publicUrl = connected ? ngrokStatus?.publicUrl ?? null : null;

  // Worktrees tab state
  const worktreeSessions = sessions.filter((s) => !!s.worktreeBranch);
  const [deletingWorktree, setDeletingWorktree] = useState<SessionInfo | null>(null);
  const [worktreeDeleteCheck, setWorktreeDeleteCheck] = useState<{ isDirty?: boolean; isUnmerged?: boolean } | null>(null);
  const [worktreeDeleting, setWorktreeDeleting] = useState(false);
  const [worktreeDeleteError, setWorktreeDeleteError] = useState<string | null>(null);

  const handleWorktreeDeleteClick = async (session: SessionInfo) => {
    setWorktreeDeleteError(null);
    setDeletingWorktree(session);
    try {
      // repoPath: for worktree sessions folderPath IS the worktree dir; we use it for git root resolution
      const check = await api.checkWorktree({
        repoPath: session.folderPath,
        worktreePath: session.folderPath,
        worktreeBranch: session.worktreeBranch,
      });
      setWorktreeDeleteCheck({ isDirty: check.isDirty, isUnmerged: check.isUnmerged });
    } catch {
      setWorktreeDeleteCheck({});
    }
  };

  const handleWorktreeDeleteConfirm = async () => {
    if (!deletingWorktree) return;
    setWorktreeDeleting(true);
    setWorktreeDeleteError(null);
    try {
      await api.deleteWorktree(
        deletingWorktree.folderPath,
        deletingWorktree.folderPath,
        worktreeDeleteCheck?.isDirty || false,
      );
      setDeletingWorktree(null);
      setWorktreeDeleteCheck(null);
    } catch (err) {
      setWorktreeDeleteError(err instanceof Error ? err.message : 'Failed to delete worktree');
    } finally {
      setWorktreeDeleting(false);
    }
  };

  const handleNotifToggle = async (v: boolean) => {
    await onSave({ notificationsEnabled: v });
  };

  // Native delivery is owned by the main process (preload bridge), NOT the
  // renderer Web Notification API. The button below round-trips through that
  // real path so the user can verify delivery and trigger the macOS auth prompt.
  const notifBridgeAvailable = typeof window !== 'undefined' && !!window.electronNotifications;
  const handleTestNotif = () => {
    window.electronNotifications?.show({
      // Must be a UUID: the main-process notif:show handler rejects any other id
      // (it's interpolated into terminal-notifier's -execute shell command). A
      // hardcoded 'argus-test' was silently dropped by that guard.
      id: crypto.randomUUID(),
      title: 'Argus',
      subtitle: 'Test',
      body: 'Notification delivery works.',
      sound: config.notificationSound,
    });
  };

  const toggleAgent = (agentId: string) => {
    setExpandedAgent((prev) => (prev === agentId ? null : agentId));
    setFlagInput('');
    setFlagError(null);
  };

  // ── Custom agent CRUD ──────────────────────────────────────────────
  const [editingAgent, setEditingAgent] = useState<{ id: string | null; name: string; command: string; installUrl: string } | null>(null);
  const [agentFormError, setAgentFormError] = useState<string | null>(null);
  const [savingAgent, setSavingAgent] = useState(false);
  const [removingAgent, setRemovingAgent] = useState<AgentDefinition | null>(null);

  const startAddAgent = () => { setEditingAgent({ id: null, name: '', command: '', installUrl: '' }); setAgentFormError(null); };
  const startEditAgent = (a: AgentDefinition) => {
    setEditingAgent({ id: a.id, name: a.name, command: a.command, installUrl: a.installUrl ?? '' });
    setAgentFormError(null);
  };

  const saveAgent = async () => {
    if (!editingAgent) return;
    const name = editingAgent.name.trim();
    const command = editingAgent.command.trim();
    const installUrl = editingAgent.installUrl.trim();
    if (!name) { setAgentFormError('Name is required.'); return; }
    if (!command) { setAgentFormError('Command is required.'); return; }
    if (!COMMAND_PATTERN.test(command)) {
      setAgentFormError('Command may contain only letters, numbers, and _ @ . / - characters.');
      return;
    }
    setSavingAgent(true);
    setAgentFormError(null);
    try {
      const existing = config.customAgents;
      const next: AgentDefinition[] = editingAgent.id === null
        ? [...existing, { id: crypto.randomUUID(), name, command, builtin: false, ...(installUrl ? { installUrl } : {}) }]
        : existing.map((a) => a.id === editingAgent.id ? { ...a, name, command, installUrl: installUrl || undefined } : a);
      await onSave({ customAgents: next });
      setEditingAgent(null);
    } catch (err) {
      setAgentFormError(err instanceof Error ? err.message : 'Failed to save agent.');
    } finally {
      setSavingAgent(false);
    }
  };

  const confirmRemoveAgent = async () => {
    if (!removingAgent) return;
    const id = removingAgent.id;
    const nextAgents = config.customAgents.filter((a) => a.id !== id);
    const nextFlags = { ...config.agentFlags };
    delete nextFlags[id];
    const patch: Partial<AppConfig> = { customAgents: nextAgents, agentFlags: nextFlags };
    if (config.defaultAgent === id) patch.defaultAgent = 'claude';
    try {
      await onSave(patch);
    } finally {
      setRemovingAgent(null);
    }
  };

  const handleAddFlag = async (agentId: string) => {
    const value = flagInput.trim();
    if (!value) return;
    if (!FLAG_PATTERN.test(value)) {
      setFlagError('Must start with -- or - followed by alphanumeric characters');
      return;
    }
    setFlagError(null);
    await onSaveFlag(agentId, { id: crypto.randomUUID(), value, enabled: true });
    setFlagInput('');
  };

  const handleNgrokStart = () => {
    if (!isNgrokPasswordValid(password)) {
      setPwErr(`Min ${NGROK_PW_MIN} characters`);
      return;
    }
    if (password !== confirmPassword) {
      setPwErr('Passwords do not match');
      return;
    }
    setPwErr(null);
    onNgrokStart(password);
    setPassword('');
    setConfirmPassword('');
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <>
    <Sheet
      eyebrow="ARGUS · SETTINGS"
      title="Preferences"
      width={920}
      onClose={onClose}
    >
      <div style={{ display: 'flex', height: 560, margin: 'calc(-1 * var(--s-5)) calc(-1 * var(--s-6))' }}>
        <aside
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings sections"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const idx = TABS.findIndex((t) => t.id === tab);
            const next = e.key === 'ArrowDown' ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
            setTab(TABS[next].id);
          }}
          style={{
            width: 200,
            background: 'var(--bg-1)',
            borderRight: '1px solid var(--line-2)',
            padding: 'var(--s-4) var(--s-2)',
          }}
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.id)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--s-2)',
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px var(--s-2)',
                  background: active ? 'var(--bg-3)' : 'transparent',
                  color: active ? 'var(--fg-0)' : 'var(--fg-1)',
                  borderRadius: 'var(--r-2)',
                  fontSize: 'var(--t-sm)',
                  borderLeft: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  marginBottom: 1,
                }}
              >
                <Icon size={13} strokeWidth={1.6} />
                {t.label}
              </button>
            );
          })}
        </aside>

        <main
          className="argus-scroll"
          style={{ flex: 1, overflow: 'auto', padding: 'var(--s-6) var(--s-7)' }}
        >
          {tab === 'general' && (
            <div style={{ maxWidth: 720 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · General</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                General
              </h2>
              <Section title="Shell header">
                <SettingRow
                  label="Quick action"
                  hint="One action pinned beside the window controls in every shell header. Everything else stays in the ⋯ menu."
                >
                  <QuickActionPicker
                    value={config.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION}
                    onChange={(tileQuickAction) => onSave({ tileQuickAction })}
                    defaultAction={DEFAULT_TILE_QUICK_ACTION}
                  />
                </SettingRow>
                <SettingRow
                  label="Window controls"
                  hint="Minimize, expand and close are always shown. Not configurable."
                >
                  <div style={{ display: 'flex', gap: 2, opacity: 0.6, color: 'var(--fg-2)' }}>
                    <Minus size={14} strokeWidth={1.7} />
                    <Maximize2 size={14} strokeWidth={1.7} />
                    <CircleX size={14} strokeWidth={1.7} />
                  </div>
                </SettingRow>
                <SettingRow
                  label="Running indicator"
                  hint="2px progress hairline under the header while an agent is working"
                >
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {([['hairline', 'Hairline'], ['off', 'Off']] as const).map(([val, label]) => {
                      const cur = config.tileRunningIndicator ?? 'hairline';
                      return (
                        <button
                          key={val}
                          onClick={() => onSave({ tileRunningIndicator: val })}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            padding: '6px var(--s-3)',
                            background: cur === val ? 'var(--accent-bg)' : 'var(--bg-1)',
                            border: `1px solid ${cur === val ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                            borderRadius: 'var(--r-2)',
                            fontSize: 'var(--t-sm)',
                            color: cur === val ? 'var(--accent)' : 'var(--fg-1)',
                            minWidth: 64,
                            textAlign: 'center',
                            boxSizing: 'border-box',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>
                {/* Sits last so it previews every pick above it — the quick action
                    AND the running indicator are the same header widget, so one
                    preview covers both. */}
                <SettingRow label="Preview" hint="How the header reads with your picks">
                  <div style={{ width: 300 }}>
                    <QuickActionPreview
                      action={config.tileQuickAction ?? DEFAULT_TILE_QUICK_ACTION}
                      runningIndicator={config.tileRunningIndicator ?? 'hairline'}
                    />
                  </div>
                </SettingRow>
                <SettingRow trailing>
                  <button
                    onClick={() => onSave({ tileQuickAction: DEFAULT_TILE_QUICK_ACTION, tileRunningIndicator: 'hairline' })}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      fontSize: 'var(--t-micro)',
                      color: 'var(--fg-3)',
                      textDecoration: 'underline',
                    }}
                  >
                    Reset shell header to defaults
                  </button>
                </SettingRow>
              </Section>
              <Section title="Appearance">
                <SettingRow label="Theme" hint="Match the system or pick a fixed appearance">
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {(['system', 'dark', 'light'] as ThemeMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          padding: '6px var(--s-3)',
                          background: mode === m ? 'var(--accent-bg)' : 'var(--bg-1)',
                          border: `1px solid ${mode === m ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                          borderRadius: 'var(--r-2)',
                          fontSize: 'var(--t-sm)',
                          color: mode === m ? 'var(--accent)' : 'var(--fg-1)',
                          minWidth: 64,
                          textAlign: 'center',
                          boxSizing: 'border-box',
                        }}
                      >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow label="Waiting attention" hint="How a shell waiting for input stands out in the mosaic">
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {([['breathing', 'Breathing halo'], ['flag', 'Pulse bar + flag']] as const).map(([val, label]) => {
                      const cur = config.mosaicWaitingStyle ?? 'breathing';
                      return (
                        <button
                          key={val}
                          onClick={() => onSave({ mosaicWaitingStyle: val })}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            padding: '6px var(--s-3)',
                            background: cur === val ? 'var(--accent-bg)' : 'var(--bg-1)',
                            border: `1px solid ${cur === val ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                            borderRadius: 'var(--r-2)',
                            fontSize: 'var(--t-sm)',
                            color: cur === val ? 'var(--accent)' : 'var(--fg-1)',
                            textAlign: 'center',
                            boxSizing: 'border-box',
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>
                {/* "Breathing halo" vs "Pulse bar + flag" is unreadable as text —
                    the difference is the motion, so show it moving. */}
                <SettingRow label="Preview" hint="A waiting shell in the mosaic, animating">
                  <WaitingStylePreview style={config.mosaicWaitingStyle ?? 'breathing'} />
                </SettingRow>
              </Section>
              <Section title="Typography">
                <SettingRow label="Code font size" hint="Shell terminals, file viewer, and diffs">
                  <FontSizeSelect
                    presets={CODE_FONT_PRESETS}
                    value={config.codeFontSize}
                    defaultPx={DEFAULT_CODE_FONT_PX}
                    onChange={(px) => onSave({ codeFontSize: px })}
                  />
                </SettingRow>
                <SettingRow label="Interface font size" hint="Menus, panels, labels, and the rest of the app">
                  <FontSizeSelect
                    presets={UI_FONT_PRESETS}
                    value={config.uiFontSize}
                    defaultPx={DEFAULT_UI_FONT_PX}
                    onChange={(px) => onSave({ uiFontSize: px })}
                  />
                </SettingRow>
                <SettingRow trailing>
                  <Button
                    variant="ghost"
                    onClick={() => onSave({ codeFontSize: DEFAULT_CODE_FONT_PX, uiFontSize: DEFAULT_UI_FONT_PX })}
                    disabled={(config.codeFontSize ?? DEFAULT_CODE_FONT_PX) === DEFAULT_CODE_FONT_PX && (config.uiFontSize ?? DEFAULT_UI_FONT_PX) === DEFAULT_UI_FONT_PX}
                  >
                    Reset to defaults
                  </Button>
                </SettingRow>
              </Section>
              <Section title="Clock">
                <SettingRow label="Show clock in toolbar" hint="Displays current time (HH:MM) before the remote access icon">
                  <Toggle checked={config.showClock ?? false} onChange={(v) => onSave({ showClock: v })} />
                </SettingRow>
                {(config.showClock ?? false) && (
                  <SettingRow label="Show seconds" hint="Extends the clock to HH:MM:SS">
                    <Toggle checked={config.clockShowSeconds ?? false} onChange={(v) => onSave({ clockShowSeconds: v })} />
                  </SettingRow>
                )}
              </Section>
              <Section title="Power">
                <SettingRow label="Keep Mac awake while running" hint="Prevents macOS from sleeping while at least one shell is running">
                  <Toggle checked={config.preventSleepWhileRunning ?? false} onChange={(v) => onSave({ preventSleepWhileRunning: v })} />
                </SettingRow>
              </Section>
              <Section title="Sessions">
                <SettingRow label="Exit all sessions on Quit" hint="When off, Cmd+Q keeps sessions running in the background. When on, Cmd+Q terminates every Claude session.">
                  <Toggle checked={config.exitSessionsOnQuit ?? false} onChange={(v) => onSave({ exitSessionsOnQuit: v })} />
                </SettingRow>
                {(config.exitSessionsOnQuit ?? false) && (
                  <SettingRow label="Confirm before exiting" hint="Show a confirmation dialog listing running sessions before Cmd+Q terminates them">
                    <Toggle checked={config.confirmExitOnQuit ?? true} onChange={(v) => onSave({ confirmExitOnQuit: v })} />
                  </SettingRow>
                )}
                <SettingRow
                  label="Use argusd daemon"
                  hint="Default process backend (survives app quit without tmux). Turn off to use the legacy tmux backend. Applies on the next app launch."
                >
                  <Toggle
                    checked={(config.ptyBackend ?? 'auto') !== 'tmux'}
                    onChange={async (v) => {
                      const target: 'auto' | 'tmux' = v ? 'auto' : 'tmux';
                      if (target === (config.ptyBackend ?? 'auto')) return;
                      const choice = await showNativeMessageBox({
                        type: 'question',
                        message: v ? 'Switch to the argusd daemon backend?' : 'Switch to the legacy tmux backend?',
                        detail:
                          'Running sessions stay on their current backend. The switch applies to sessions hosted after the app restarts.',
                        buttons: ['Cancel', 'Apply on next launch', 'Restart now'],
                        defaultId: 2,
                        cancelId: 0,
                      }).catch(() => 0);
                      if (choice === 0) return; // Cancel — Toggle is config-controlled, so it snaps back
                      await onSave({ ptyBackend: target });
                      if (choice === 2) window.electronApp?.relaunch();
                    }}
                  />
                </SettingRow>
              </Section>
              <Section title="Developer">
                <SettingRow label="Enable developer tools" hint="Adds a per-session diagnostics dump button (writes session state + output to ~/.argus/diagnostics for debugging)">
                  <Toggle checked={config.debugToolsEnabled ?? false} onChange={(v) => onSave({ debugToolsEnabled: v })} />
                </SettingRow>
              </Section>
              <Section title="Groups">
                <SettingRow label='"Others" folder name' hint="Display name for the ungrouped shells bucket">
                  <TextInput
                    value={othersNameDraft}
                    onChange={(value) => setOthersNameDraft(value)}
                    onBlur={() => {
                      const trimmed = othersNameDraft.trim();
                      if (trimmed.length >= 1) {
                        onSave({ othersFolderName: trimmed });
                      } else {
                        setOthersNameDraft(config.othersFolderName ?? 'Others');
                      }
                    }}
                  />
                </SettingRow>
              </Section>
            </div>
          )}

          {tab === 'keyboard' && (
            <KeyboardSettings config={config} onSave={onSave} />
          )}

          {tab === 'agents' && (
            <div style={{ maxWidth: 720 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Agents</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Default agent & libraries
              </h2>

              <Section title="Default agent">
                <div className="settings-card-pad">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--s-2)' }}>
                    {agents.map((a) => {
                      const sel = config.defaultAgent === a.id;
                      return (
                        <button
                          key={a.id}
                          onClick={() => onSave({ defaultAgent: a.id })}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 6,
                            padding: 'var(--s-3) var(--s-2)',
                            background: sel ? 'var(--accent-bg)' : 'var(--bg-1)',
                            border: `1px solid ${sel ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                            borderRadius: 'var(--r-2)',
                          }}
                        >
                          <AgentGlyph agent={a.id} size={28} />
                          <span style={{ fontSize: 'var(--t-xs)', color: sel ? 'var(--accent)' : 'var(--fg-1)' }}>{a.id}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>

              <Section title="Installed agents" action={<Button variant="outline" size="sm" icon={Plus} onClick={startAddAgent}>Add custom</Button>}>
                {editingAgent && (
                  <div style={{
                    display: 'flex', flexDirection: 'column', gap: 'var(--s-3)',
                    padding: 'var(--s-4)',
                    background: 'var(--bg-1)',
                    borderBottom: '1px solid var(--accent-edge)',
                  }}>
                    <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)' }}>
                      {editingAgent.id === null ? 'Add custom agent' : 'Edit agent'}
                    </div>
                    <Field label="Name" required>
                      <TextInput value={editingAgent.name} onChange={(v) => setEditingAgent((s) => s && { ...s, name: v })} placeholder="e.g. Aider" />
                    </Field>
                    <Field label="Command" required hint="binary + args · letters, numbers, _ @ . / - only">
                      <TextInput value={editingAgent.command} onChange={(v) => setEditingAgent((s) => s && { ...s, command: v })} placeholder="e.g. aider" mono />
                    </Field>
                    <Field label="Install URL" hint="optional">
                      <TextInput value={editingAgent.installUrl} onChange={(v) => setEditingAgent((s) => s && { ...s, installUrl: v })} placeholder="https://…" mono />
                    </Field>
                    {agentFormError && (
                      <div style={{ fontSize: 'var(--t-xs)', color: 'var(--danger)' }}>{agentFormError}</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
                      <Button variant="ghost" size="sm" onClick={() => setEditingAgent(null)}>Cancel</Button>
                      <Button variant="primary" size="sm" loading={savingAgent} onClick={() => void saveAgent()}>
                        {editingAgent.id === null ? 'Add agent' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
                {agents.map((a) => {
                  const expanded = expandedAgent === a.id;
                  const agentFlags = config.agentFlags[a.id] ?? [];
                  return (
                    <Fragment key={a.id}>
                      <div
                        onClick={() => toggleAgent(a.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--s-3)',
                          padding: 'var(--s-3) var(--s-4)',
                          borderBottom: expanded ? 'none' : '1px solid var(--line-1)',
                          cursor: 'pointer',
                          background: expanded ? 'var(--bg-1)' : 'transparent',
                        }}
                      >
                        <AgentGlyph agent={a.id} size={28} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>{a.name}</div>
                          <div className="mono" style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
                            $ {a.command} {a.builtin ? '' : '· custom'}
                          </div>
                        </div>
                        <Chip>{agentFlags.length} flags</Chip>
                        {!a.builtin && (
                          <>
                            <IconButton icon={Pencil} label="Edit" size="sm" onClick={(e) => { e.stopPropagation(); startEditAgent(a); }} />
                            <IconButton icon={Trash2} label="Remove" size="sm" onClick={(e) => { e.stopPropagation(); setRemovingAgent(a); }} />
                          </>
                        )}
                        {expanded
                          ? <ChevronDown size={13} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
                          : <ChevronRight size={13} strokeWidth={1.6} style={{ color: 'var(--fg-3)', flexShrink: 0 }} />
                        }
                      </div>
                      {expanded && (
                        <div style={{
                          padding: 'var(--s-3) var(--s-4)',
                          background: 'var(--bg-1)',
                          borderBottom: '1px solid var(--line-1)',
                          borderTop: '1px solid var(--line-1)',
                        }}>
                          {agentFlags.length === 0 ? (
                            <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)', marginBottom: 'var(--s-3)' }}>
                              No flags yet
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)', marginBottom: 'var(--s-3)' }}>
                              {agentFlags.map((f) => (
                                <div
                                  key={f.id}
                                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}
                                >
                                  <span
                                    className="mono"
                                    style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--fg-1)' }}
                                  >
                                    {f.value}
                                  </span>
                                  <IconButton
                                    icon={Trash2}
                                    label="Delete flag"
                                    size="sm"
                                    onClick={(e) => { e.stopPropagation(); onDeleteFlag(a.id, f.id); }}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <TextInput
                                value={flagInput}
                                onChange={(v) => { setFlagInput(v); setFlagError(null); }}
                                placeholder="--flag value"
                                mono
                                onKeyDown={(e) => { if (e.key === 'Enter') void handleAddFlag(a.id); }}
                                error={!!flagError}
                              />
                              {flagError && (
                                <div style={{ marginTop: 4, fontSize: 'var(--t-tiny)', color: 'var(--danger)' }}>
                                  {flagError}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              icon={Flag}
                              onClick={(e) => { e.stopPropagation(); void handleAddFlag(a.id); }}
                              disabled={!flagInput.trim()}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </Section>
            </div>
          )}

          {tab === 'notif' && (
            <div style={{ maxWidth: 580 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Notifications</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Notifications
              </h2>
              <div style={{ background: 'var(--bg-2)', borderRadius: 'var(--r-4)', border: '1px solid var(--line-2)', overflow: 'hidden' }}>

                {/* Master toggle */}
                <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
                  <Toggle
                    checked={config.notificationsEnabled}
                    onChange={handleNotifToggle}
                    label="Native desktop notifications"
                  />
                </div>
                <div style={{ height: 1, background: 'var(--line-2)' }} />

                {/* Body — always rendered, dimmed when master is off */}
                <div style={{ opacity: config.notificationsEnabled ? 1 : 0.35, pointerEvents: config.notificationsEnabled ? 'auto' : 'none', transition: 'opacity var(--dur-base)' }}>

                  {/* WHEN TO NOTIFY */}
                  <div style={{ fontSize: 'var(--t-micro)', fontWeight: 600, letterSpacing: 'var(--tracking-eye)', textTransform: 'uppercase' as const, color: 'var(--fg-3)', padding: 'var(--s-3) var(--s-4) var(--s-1)' }}>
                    When to notify
                  </div>
                  {([
                    { icon: <Timer size={13} strokeWidth={1.6} />, label: 'Shell needs your input', checked: config.notifyOnWaiting ?? true, onChange: (v: boolean) => { void onSave({ notifyOnWaiting: v }); } },
                    { icon: <Check size={13} strokeWidth={1.6} />, label: 'Shell finishes a run',   checked: config.notifyOnDone   ?? false, onChange: (v: boolean) => { void onSave({ notifyOnDone: v }); } },
                  ] as const).map(({ icon, label, checked, onChange }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '9px var(--s-4)' }}>
                      <span style={{ color: 'var(--fg-3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</span>
                      <span style={{ flex: 1, fontSize: 'var(--t-base)', color: 'var(--fg-1)' }}>{label}</span>
                      <Toggle checked={checked} onChange={onChange} />
                    </div>
                  ))}

                  <div style={{ height: 1, background: 'var(--line-2)' }} />

                  {/* SOUND */}
                  <div style={{ fontSize: 'var(--t-micro)', fontWeight: 600, letterSpacing: 'var(--tracking-eye)', textTransform: 'uppercase' as const, color: 'var(--fg-3)', padding: 'var(--s-3) var(--s-4) var(--s-1)' }}>
                    Sound
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', padding: '9px var(--s-4)' }}>
                    <span style={{ color: 'var(--fg-3)', display: 'flex', alignItems: 'center', flexShrink: 0 }}><Volume2 size={13} strokeWidth={1.6} /></span>
                    <span style={{ flex: 1, fontSize: 'var(--t-base)', color: 'var(--fg-1)' }}>Play a sound</span>
                    <Toggle checked={config.notificationSound ?? false} onChange={(v) => { void onSave({ notificationSound: v }); }} />
                  </div>

                </div>

                <div style={{ height: 1, background: 'var(--line-2)' }} />

                {/* Footer — always interactive regardless of master toggle */}
                <div style={{ padding: 'var(--s-3) var(--s-4) var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
                  <p style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)', lineHeight: 1.5 }}>
                    Notifications fire only while Argus is in the background. Managed in macOS System Settings → Notifications.
                  </p>
                  {notifBridgeAvailable ? (
                    <button
                      type="button"
                      onClick={handleTestNotif}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'var(--s-2)',
                        cursor: 'pointer',
                        padding: '8px 14px',
                        borderRadius: 'var(--r-2)',
                        fontSize: 'var(--t-sm)',
                        fontWeight: 500,
                        fontFamily: 'inherit',
                        background: 'var(--accent-bg)',
                        border: '1px solid var(--accent-edge)',
                        color: 'var(--accent)',
                      }}
                    >
                      <Bell size={13} strokeWidth={1.6} />
                      Send test notification
                    </button>
                  ) : (
                    <p style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
                      This surface can't show desktop notifications.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'remote' && (
            <div style={{ maxWidth: 520 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Remote</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Remote access
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--s-2)',
                    padding: 'var(--s-3) var(--s-4)',
                    background: 'var(--bg-1)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 'var(--r-2)',
                  }}
                >
                  {connected ? (
                    <>
                      <StatusDot status="running" size={8} />
                      <Wifi size={14} strokeWidth={1.6} color="var(--accent)" />
                      <span className="eyebrow" style={{ color: 'var(--accent)' }}>ACTIVE</span>
                    </>
                  ) : (
                    <>
                      <WifiOff size={14} strokeWidth={1.6} color="var(--fg-3)" />
                      <span className="eyebrow">OFFLINE</span>
                    </>
                  )}
                  {ngrokStatus && !ngrokStatus.installed && (
                    <span className="eyebrow" style={{ color: 'var(--warn)' }}>NGROK NOT INSTALLED</span>
                  )}
                </div>

                {ngrokError && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px var(--s-3)',
                      background: 'var(--danger-bg)',
                      border: '1px solid color-mix(in srgb, var(--danger) 44%, transparent)',
                      borderRadius: 'var(--r-2)',
                      color: 'var(--danger)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--t-sm)',
                    }}
                  >
                    <AlertTriangle size={12} strokeWidth={1.6} />
                    {ngrokError}
                  </div>
                )}

                {connected && publicUrl && (
                  <>
                    <Field label="Public URL">
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--s-2)',
                          padding: '6px var(--s-3)',
                          background: 'var(--bg-inset)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-2)',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--t-sm)',
                            color: 'var(--accent)',
                            flex: 1,
                            wordBreak: 'break-all',
                          }}
                        >
                          {publicUrl}
                        </span>
                        <Button variant="ghost" size="sm" icon={copied ? Check : Copy} onClick={() => copy(publicUrl)}>
                          {copied ? 'Copied' : 'Copy'}
                        </Button>
                        <a
                          href={publicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="eyebrow"
                          style={{ color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <ExternalLink size={11} strokeWidth={1.6} /> OPEN
                        </a>
                      </div>
                    </Field>

                    <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-3)' }}>
                      <div
                        style={{
                          background: '#fff',
                          padding: 'var(--s-3)',
                          borderRadius: 'var(--r-3)',
                          boxShadow: 'var(--shadow-pop)',
                        }}
                      >
                        <QRCodeSVG value={`${publicUrl}/mobile`} size={160} bgColor="#fff" fgColor="#000" />
                      </div>
                    </div>
                    <p className="eyebrow" style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
                      SCAN TO OPEN MOBILE COMPANION
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button variant="danger" onClick={onNgrokStop} loading={ngrokLoading} disabled={ngrokLoading}>
                        Stop tunnel
                      </Button>
                    </div>
                  </>
                )}

                {!connected && (
                  <>
                    <PasswordFields
                      password={password}
                      confirmPassword={confirmPassword}
                      onPassword={setPassword}
                      onConfirm={setConfirmPassword}
                      onSubmit={handleNgrokStart}
                      error={pwErr ?? undefined}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="primary"
                        onClick={handleNgrokStart}
                        loading={ngrokLoading}
                        disabled={ngrokLoading || !isNgrokPasswordValid(password) || password !== confirmPassword}
                      >
                        Start tunnel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          {tab === 'worktrees' && (
            <div style={{ maxWidth: 720 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Agent Isolation</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Agent Isolation
              </h2>
              <div style={{ color: 'var(--fg-2)', fontSize: 'var(--t-sm)', lineHeight: 1.6, marginBottom: 'var(--s-5)' }}>
                Each isolated session runs in its own git worktree — a separate working directory branched off your repo.
                Changes stay sandboxed until you're ready to merge, so multiple agents can work in parallel without stepping on each other's files.
                Sessions with isolation enabled appear here; remove a worktree once its work is merged or discarded.
              </div>
              {worktreeSessions.length === 0 ? (
                <div style={{ color: 'var(--fg-2)', fontSize: 'var(--t-sm)', padding: 'var(--s-4) 0' }}>
                  No worktree sessions. Create a session with a worktree to see it here.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
                  {worktreeSessions.map((s) => {
                    const isLive = s.status !== 'exited';
                    return (
                      <div
                        key={s.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'var(--s-3)',
                          padding: 'var(--s-3) var(--s-4)',
                          background: 'var(--bg-1)',
                          border: '1px solid var(--line-2)',
                          borderRadius: 'var(--r-2)',
                        }}
                      >
                        <GitBranch size={14} strokeWidth={1.6} color="var(--accent)" style={{ flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)', color: 'var(--fg-0)', fontWeight: 500 }}>
                            {s.worktreeBranch}
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', color: 'var(--fg-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.folderPath}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)', flexShrink: 0 }}>
                          <span style={{
                            fontSize: 'var(--t-micro)',
                            fontFamily: 'var(--font-mono)',
                            letterSpacing: 'var(--tracking-eye)',
                            color: isLive ? 'var(--status-running)' : 'var(--fg-3)',
                          }}>
                            {s.name} · {s.status}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isLive}
                            onClick={() => void handleWorktreeDeleteClick(s)}
                            title={isLive ? 'Close session first' : 'Delete worktree'}
                          >
                            <Trash2 size={12} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {worktreeDeleteError && (
                <div style={{ color: 'var(--danger)', fontSize: 'var(--t-sm)', marginTop: 'var(--s-3)' }}>
                  {worktreeDeleteError}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </Sheet>

    {/* Custom agent remove confirm */}
    <AlertSheet
      isOpen={removingAgent !== null}
      title="Remove agent?"
      message={`Remove "${removingAgent?.name ?? ''}"? Its saved flags will be cleared. This does not uninstall the CLI.`}
      confirmLabel="Remove agent"
      confirmDestructive
      onConfirm={() => void confirmRemoveAgent()}
      onCancel={() => setRemovingAgent(null)}
    />

    {/* Worktree delete confirm dialog */}
    {(() => {
      const open = deletingWorktree !== null && worktreeDeleteCheck !== null;
      const warnings: string[] = [];
      if (worktreeDeleteCheck?.isDirty) warnings.push('This worktree has uncommitted changes.');
      if (worktreeDeleteCheck?.isUnmerged) warnings.push('This branch has unmerged commits.');
      const baseMsg = warnings.length > 0
        ? warnings.join(' ') + '\n\nDelete the worktree directory anyway?'
        : `Delete worktree "${deletingWorktree?.worktreeBranch ?? ''}"? This removes the directory but keeps the branch in git.`;
      const message = worktreeDeleteError ? `${baseMsg}\n\n${worktreeDeleteError}` : baseMsg;
      return (
        <AlertSheet
          isOpen={open}
          title="Delete worktree?"
          message={message}
          confirmLabel="Delete worktree"
          confirmDestructive
          confirmLoading={worktreeDeleting}
          onConfirm={() => void handleWorktreeDeleteConfirm()}
          onCancel={() => { setDeletingWorktree(null); setWorktreeDeleteCheck(null); setWorktreeDeleteError(null); }}
        />
      );
    })()}
    </>
  );
}
