import { ChevronLeft, Check } from 'lucide-react';
import { useKeyboardMode, type KeyboardMode } from '../../hooks/useKeyboardMode.js';

interface MobileSettingsProps {
  onBack: () => void;
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

/** Full-screen global mobile settings page. Home for all mobile settings;
 *  first section selects the keyboard mode. */
export function MobileSettings({ onBack }: MobileSettingsProps) {
  const [mode, setMode] = useKeyboardMode();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--bg-0)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-2)',
          padding: '0 var(--s-3)',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 52,
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--line-2)',
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          aria-label="Back"
          className="eyebrow"
          style={{
            background: 'transparent',
            border: '1px solid var(--line-2)',
            cursor: 'pointer',
            color: 'var(--accent)',
            borderRadius: 'var(--r-2)',
            padding: '0 12px',
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 'var(--t-tiny)',
          }}
        >
          <ChevronLeft size={14} strokeWidth={1.6} />
          BACK
        </button>
        <span className="eyebrow" style={{ flex: 1, fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>SETTINGS</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        <div className="eyebrow" style={{ padding: 'var(--s-4) var(--s-4) var(--s-2)', color: 'var(--fg-3)' }}>KEYBOARD</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', padding: '0 var(--s-3) var(--s-4)' }}>
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
                }}
              >
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flexShrink: 0,
                    marginTop: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: selected ? 'var(--accent)' : 'transparent',
                    border: `1px solid ${selected ? 'var(--accent)' : 'var(--line-3)'}`,
                    color: 'var(--fg-on-accent)',
                  }}
                >
                  {selected && <Check size={12} strokeWidth={3} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--t-base)', fontWeight: 600, color: 'var(--fg-0)' }}>{opt.title}</div>
                  <div style={{ marginTop: 2, fontSize: 'var(--t-tiny)', color: 'var(--fg-2)', lineHeight: 1.45 }}>{opt.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
