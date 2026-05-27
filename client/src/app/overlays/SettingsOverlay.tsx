import { useState } from 'react';
import type { AppConfig, AgentDefinition } from '@argus/shared';
import { Sliders, Cpu, Flag, Bell, Keyboard, Sparkles, Plus, Pencil, Trash2 } from 'lucide-react';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import {
  Sheet,
  Section,
  Chip,
  Toggle,
  IconButton,
  Button,
} from '../../components/primitives/index.js';

interface SettingsOverlayProps {
  config: AppConfig;
  onClose: () => void;
  onSave: (data: Partial<AppConfig>) => Promise<AppConfig>;
}

type Tab = 'general' | 'agents' | 'flags' | 'notif' | 'short' | 'adv';

const TABS: { id: Tab; icon: typeof Sliders; label: string }[] = [
  { id: 'general', icon: Sliders, label: 'General' },
  { id: 'agents', icon: Cpu, label: 'Agents' },
  { id: 'flags', icon: Flag, label: 'Flag library' },
  { id: 'notif', icon: Bell, label: 'Notifications' },
  { id: 'short', icon: Keyboard, label: 'Shortcuts' },
  { id: 'adv', icon: Sparkles, label: 'Advanced' },
];

const BUILTIN: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', builtin: true },
  { id: 'gemini', name: 'Gemini', command: 'gemini', builtin: true },
  { id: 'codex', name: 'Codex', command: 'codex', builtin: true },
];

export function SettingsOverlay({ config, onClose, onSave }: SettingsOverlayProps) {
  const [tab, setTab] = useState<Tab>('agents');
  const agents = [...BUILTIN, ...config.customAgents];

  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(
    'Notification' in window ? Notification.permission : 'unsupported'
  );

  const handleNotifToggle = async (v: boolean) => {
    if (v && 'Notification' in window && Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
    }
    await onSave({ notificationsEnabled: v });
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
                {agents.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--s-3)',
                      padding: 'var(--s-3) var(--s-4)',
                      borderBottom: '1px solid var(--line-1)',
                    }}
                  >
                    <AgentGlyph agent={a.id} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>{a.name}</div>
                      <div className="mono" style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)' }}>
                        $ {a.command} {a.builtin ? '' : '· custom'}
                      </div>
                    </div>
                    <Chip>{(config.agentFlags[a.id] ?? []).length} flags</Chip>
                    {!a.builtin && (
                      <>
                        <IconButton icon={Pencil} label="Edit" size="sm" />
                        <IconButton icon={Trash2} label="Remove" size="sm" />
                      </>
                    )}
                  </div>
                ))}
              </Section>

              <Section title="Flag library">
                <div style={{ padding: 'var(--s-3) var(--s-4)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(config.agentFlags[config.defaultAgent] ?? []).map((f) => (
                    <Chip key={f.id} icon={Flag}>{f.value}</Chip>
                  ))}
                  {(config.agentFlags[config.defaultAgent] ?? []).length === 0 && (
                    <span className="eyebrow" style={{ color: 'var(--fg-3)' }}>
                      NO FLAGS YET · ADD VIA CREATE SHEET
                    </span>
                  )}
                </div>
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
                  label="Native desktop notifications when a session enters waiting"
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

          {(tab === 'general' || tab === 'flags' || tab === 'short' || tab === 'adv') && (
            <div style={{ maxWidth: 720, color: 'var(--fg-2)' }}>
              <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · {TABS.find((x) => x.id === tab)?.label}</div>
              <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
                Coming soon
              </h2>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--t-sm)' }}>
                This section is a placeholder.
              </p>
            </div>
          )}
        </main>
      </div>
    </Sheet>
  );
}
