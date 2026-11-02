import { Check, Wifi, Bell } from 'lucide-react';
import { useKeyboardMode, type KeyboardMode } from '../../hooks/useKeyboardMode.js';
import { useTheme, type ThemeMode } from '../../context/theme-context.js';
import { StatusDot, Switch, Icon, Row, Stack, Text } from '../../components/primitives/index.js';

interface MobileSettingsProps {
  publicUrl: string | null;
  notify: boolean;
  onSetNotify: (v: boolean) => void;
  notifyDone: boolean;
  onSetNotifyDone: (v: boolean) => void;
}

const KEYBOARD_OPTIONS: { id: KeyboardMode; title: string; desc: string }[] = [
  {
    id: 'hybrid',
    title: 'Action pad + native keyboard',
    desc: 'Special keys (arrows, esc, ^C…) by default. Tap “abc” for the native keyboard to type. Recommended.',
  },
  {
    id: 'dual',
    title: 'Full custom keyboard',
    desc: 'Two views — special keys and a built-in QWERTY. Never uses the native keyboard.',
  },
];

const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'Auto' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

/** Full settings tab. Home for all mobile settings. */
export function MobileSettings({ publicUrl, notify, onSetNotify, notifyDone, onSetNotifyDone }: MobileSettingsProps) {
  const [mode, setMode] = useKeyboardMode();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const notifySupported = typeof Notification !== 'undefined';

  return (
    <Stack style={{ height: '100%', background: 'var(--bg-0)' }}>
      <Row
        style={{
          padding: '0 var(--s-4)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 52,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <span className="eyebrow" style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>SETTINGS</span>
      </Row>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {/* Appearance */}
        <GroupLabel>Appearance</GroupLabel>
        <Row justify="between" style={{ padding: 'var(--s-3) var(--s-4) var(--s-4)' }}>
          <div>
            <Text as="div" size="body" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-0)' }}>Theme</Text>
            <Text as="div" size="caption" tone="faint">Match your phone or pin one</Text>
          </div>
          <Row align="stretch" style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-pill)', overflow: 'hidden' }}>
            {THEME_OPTIONS.map((opt) => {
              const on = themeMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setThemeMode(opt.id)}
                  className="eyebrow"
                  style={{
                    fontSize: 'var(--t-tiny)',
                    padding: 'var(--s-2) var(--s-3)',
                    border: 'none',
                    cursor: 'pointer',
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--fg-on-accent)' : 'var(--fg-2)',
                    fontWeight: on ? 700 : 400,
                    transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast)',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </Row>
        </Row>

        {/* Notifications */}
        {notifySupported && (
          <>
            <GroupLabel>Notifications</GroupLabel>
            <div style={{ padding: '0 var(--s-3) var(--s-2)' }}>
              <button
                onClick={() => onSetNotify(!notify)}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)', padding: 'var(--s-3)' }}
              >
                <Icon icon={Bell} size="xl" style={{ color: 'var(--fg-2)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 'var(--t-body)', color: 'var(--fg-0)' }}>Alert when a session needs you</span>
                  <Text size="caption" tone="faint" style={{ display: 'block' }}>Notifies on the → waiting transition while this tab is in the background.</Text>
                </span>
                <Switch on={notify} />
              </button>
            </div>
            <div style={{ padding: '0 var(--s-3) var(--s-2)' }}>
              <button
                onClick={() => onSetNotifyDone(!notifyDone)}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', width: '100%', textAlign: 'left', cursor: 'pointer', background: 'var(--bg-1)', border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)', padding: 'var(--s-3)' }}
              >
                <Icon icon={Bell} size="xl" style={{ color: 'var(--fg-2)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: 'var(--font-sans)', fontSize: 'var(--t-body)', color: 'var(--fg-0)' }}>Alert when a session finishes</span>
                  <Text size="caption" tone="faint" style={{ display: 'block' }}>Notifies on the → done transition while this tab is in the background.</Text>
                </span>
                <Switch on={notifyDone} />
              </button>
            </div>
          </>
        )}

        {/* Keyboard */}
        <GroupLabel>Keyboard</GroupLabel>
        <Stack gap={2} style={{ padding: '0 var(--s-3) var(--s-4)' }}>
          {KEYBOARD_OPTIONS.map((opt) => {
            const selected = mode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setMode(opt.id)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--s-3)',
                  textAlign: 'left',
                  padding: 'var(--s-3)',
                  borderRadius: 'var(--r-2)',
                  cursor: 'pointer',
                  background: selected ? 'var(--accent-bg)' : 'var(--bg-1)',
                  border: `1px solid ${selected ? 'var(--accent-edge)' : 'var(--line-2)'}`,
                  transition: 'background var(--dur-fast) var(--ease), border-color var(--dur-fast)',
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flexShrink: 0,
                    marginTop: 'var(--s-px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: selected ? 'var(--accent)' : 'transparent',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--line-3)'}`,
                    color: 'var(--fg-on-accent)',
                  }}
                >
                  {selected && <Icon icon={Check} size="sm" strokeWidth={2} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <Text as="div" size="body" weight={600} style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-0)' }}>{opt.title}</Text>
                  <Text as="div" size="caption" tone="muted" style={{ marginTop: 'var(--s-0-5)', lineHeight: 1.45 }}>{opt.desc}</Text>
                </div>
              </button>
            );
          })}
        </Stack>

        {/* Remote access — read-only on mobile */}
        <GroupLabel>Remote access</GroupLabel>
        <div style={{ padding: '0 var(--s-3) var(--s-6)' }}>
          <div style={{ border: '1px solid var(--line-2)', borderRadius: 'var(--r-3)', background: 'var(--bg-1)', padding: 'var(--s-3)' }}>
            <Row gap={3}>
              <Icon icon={Wifi} size="xl" style={{ color: 'var(--fg-2)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text as="div" size="body" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-0)' }}>
                  {publicUrl ? 'Tunnel connected' : 'Tunnel not active'}
                </Text>
                <Text as="div" size="caption" tone="faint">
                  {publicUrl ? "You're viewing through this link — manage it from Argus on your Mac." : 'Enable remote access from Argus on your Mac.'}
                </Text>
              </div>
              {publicUrl && <StatusDot status="running" size={6} />}
            </Row>
          </div>
        </div>
      </div>
    </Stack>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="eyebrow" style={{ padding: 'var(--s-4) var(--s-4) var(--s-2)', color: 'var(--fg-3)' }}>
      {children}
    </div>
  );
}

