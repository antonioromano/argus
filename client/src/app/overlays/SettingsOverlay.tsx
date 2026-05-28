import { useState, Fragment } from 'react';
import type { AppConfig, AgentDefinition, AgentFlag, NgrokStatus } from '@argus/shared';
import { SlidersHorizontal, Cpu, Bell, Plus, Pencil, Trash2, ChevronDown, ChevronRight, Flag, Wifi, WifiOff, Copy, Check, AlertTriangle, ExternalLink } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { useTheme } from '../../context/ThemeContext.js';
import type { ThemeMode } from '../../context/ThemeContext.js';
import {
  Sheet,
  Section,
  Field,
  Chip,
  Toggle,
  IconButton,
  Button,
  TextInput,
  StatusDot,
} from '../../components/primitives/index.js';

interface SettingsOverlayProps {
  config: AppConfig;
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

type Tab = 'general' | 'agents' | 'notif' | 'remote';

const TABS: { id: Tab; icon: typeof Cpu; label: string }[] = [
  { id: 'general', icon: SlidersHorizontal, label: 'General' },
  { id: 'agents', icon: Cpu, label: 'Agents' },
  { id: 'notif', icon: Bell, label: 'Notifications' },
  { id: 'remote', icon: Wifi, label: 'Remote' },
];

const BUILTIN: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];

const FLAG_PATTERN = /^--?[a-zA-Z0-9][a-zA-Z0-9\-_.=:,/ ]*$/;

export function SettingsOverlay({ config, onClose, onSave, onSaveFlag, onDeleteFlag, ngrokStatus, ngrokLoading, ngrokError, onNgrokStart, onNgrokStop, initialTab }: SettingsOverlayProps) {
  const validInitial = (initialTab && ['general', 'agents', 'notif', 'remote'].includes(initialTab)) ? initialTab as Tab : 'agents';
  const [tab, setTab] = useState<Tab>(validInitial);
  const { mode, setMode } = useTheme();
  const agents = [...BUILTIN, ...config.customAgents];

  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [flagInput, setFlagInput] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connected = ngrokStatus?.tunnelStatus === 'connected';
  const publicUrl = connected ? ngrokStatus?.publicUrl ?? null : null;

  const handleNotifToggle = async (v: boolean) => {
    if (v && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    }
    await onSave({ notificationsEnabled: v });
  };

  const toggleAgent = (agentId: string) => {
    setExpandedAgent((prev) => (prev === agentId ? null : agentId));
    setFlagInput('');
    setFlagError(null);
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
    if (password.length < 4) {
      setPwErr('Min 4 characters');
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
              <Section title="Appearance">
                <div style={{ padding: 'var(--s-4)' }}>
                  <div style={{ marginBottom: 'var(--s-2)', fontSize: 'var(--t-sm)', color: 'var(--fg-2)' }}>Theme</div>
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {(['system', 'dark', 'light'] as ThemeMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={{
                          all: 'unset',
                          cursor: 'pointer',
                          padding: '6px var(--s-3)',
                          background: mode === m ? 'var(--accent-bg)' : 'var(--bg-2)',
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
                </div>
              </Section>
            </div>
          )}

          {tab === 'agents' && (
            <div style={{ maxWidth: 720 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Agents</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Default agent & libraries
              </h2>

              <Section title="Default agent">
                <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
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

              <Section title="Installed agents" action={<Button variant="outline" size="sm" icon={Plus}>Add custom</Button>}>
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
                          background: expanded ? 'var(--bg-2)' : 'transparent',
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
                            <IconButton icon={Pencil} label="Edit" size="sm" onClick={(e) => e.stopPropagation()} />
                            <IconButton icon={Trash2} label="Remove" size="sm" onClick={(e) => e.stopPropagation()} />
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
                          background: 'var(--bg-2)',
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
            <div style={{ maxWidth: 720 }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Notifications</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Notifications
              </h2>
              <div style={{ padding: 'var(--s-4)', background: 'var(--bg-1)', borderRadius: 'var(--r-2)', border: '1px solid var(--line-2)' }}>
                <Toggle
                  checked={config.notificationsEnabled}
                  onChange={handleNotifToggle}
                  label="Native desktop notifications when a shell enters waiting"
                />
                {config.notificationsEnabled && notifPermission === 'denied' && (
                  <p style={{ margin: 'var(--s-3) 0 0', fontSize: 'var(--t-sm)', color: 'var(--warn)' }}>
                    Notifications blocked. Enable Argus under System Settings → Notifications.
                  </p>
                )}
                {config.notificationsEnabled && notifPermission === 'unsupported' && (
                  <p style={{ margin: 'var(--s-3) 0 0', fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
                    This surface can't show desktop notifications.
                  </p>
                )}
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
                    <Field label="Password" required hint="Min 4 characters" error={pwErr ?? undefined}>
                      <TextInput
                        value={password}
                        onChange={setPassword}
                        type="password"
                        placeholder="Set password"
                        mono
                      />
                    </Field>
                    <Field label="Confirm password" required>
                      <TextInput
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        type="password"
                        placeholder="Re-enter password"
                        mono
                        onKeyDown={(e) => { if (e.key === 'Enter') handleNgrokStart(); }}
                      />
                    </Field>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <Button
                        variant="primary"
                        onClick={handleNgrokStart}
                        loading={ngrokLoading}
                        disabled={ngrokLoading || password.length < 4 || password !== confirmPassword}
                      >
                        Start tunnel
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </Sheet>
  );
}
