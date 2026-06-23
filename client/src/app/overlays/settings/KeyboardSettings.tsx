import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '@argus/shared';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Section, SettingRow, Toggle } from '../../../components/primitives/index.js';
import { SHORTCUTS, CATEGORY_ORDER, type ShortcutActionId } from '../../../keyboard/registry.js';
import { resolveShortcuts, findConflicts } from '../../../keyboard/useShortcuts.js';
import { eventToCombo, formatCombo, isLoneModifier } from '../../../keyboard/combo.js';

interface KeyboardSettingsProps {
  config: AppConfig;
  onSave: (data: Partial<AppConfig>) => Promise<AppConfig>;
}

export function KeyboardSettings({ config, onSave }: KeyboardSettingsProps) {
  const overrides = useMemo(() => config.keyboardShortcuts ?? {}, [config.keyboardShortcuts]);
  const resolved = resolveShortcuts(overrides);
  const conflicts = findConflicts(resolved);
  const [recording, setRecording] = useState<ShortcutActionId | null>(null);

  // While recording, the next real keystroke becomes the binding. Capture phase so
  // we intercept before the global shortcut handler acts on (and consumes) the combo.
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      if (isLoneModifier(e)) return; // still waiting for a non-modifier key
      onSave({ keyboardShortcuts: { ...overrides, [recording]: eventToCombo(e) } });
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, overrides, onSave]);

  const resetOne = (id: ShortcutActionId) => {
    const next = { ...overrides };
    delete next[id];
    void onSave({ keyboardShortcuts: next });
  };
  const resetAll = () => void onSave({ keyboardShortcuts: {} });

  const hasOverrides = Object.keys(overrides).length > 0;

  const comboPill = (danger = false): React.CSSProperties => ({
    minWidth: 56,
    textAlign: 'center',
    padding: '3px 8px',
    border: `1px solid ${danger ? 'var(--danger)' : 'var(--line-2)'}`,
    background: 'var(--bg-2)',
    borderRadius: 'var(--r-1)',
    fontSize: 'var(--t-sm)',
    fontFamily: 'var(--font-mono)',
    color: danger ? 'var(--danger)' : 'var(--fg-0)',
  });

  const actionBtn: React.CSSProperties = {
    all: 'unset',
    cursor: 'pointer',
    padding: '4px 10px',
    border: '1px solid var(--line-2)',
    borderRadius: 'var(--r-1)',
    fontSize: 'var(--t-sm)',
    color: 'var(--fg-1)',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>Settings · Keyboard</div>
      <h2 style={{ fontSize: 'var(--t-2xl)', margin: '6px 0 var(--s-4)', letterSpacing: 'var(--tracking-tight)', fontWeight: 600 }}>
        Keyboard
      </h2>

      <Section title="Closing shells">
        <SettingRow label="Confirm before closing a shell" hint="Show a confirmation when closing a shell with ⌘W or the close button">
          <Toggle
            checked={config.confirmCloseShell !== false}
            onChange={(v) => onSave({ confirmCloseShell: v })}
          />
        </SettingRow>
      </Section>

      {CATEGORY_ORDER.map((category) => {
        const actions = SHORTCUTS.filter((s) => s.category === category);
        if (actions.length === 0) return null;
        return (
          <Section key={category} title={category}>
            {actions.map((a) => {
              const isRecording = recording === a.id;
              const conflict = conflicts.has(a.id);
              const overridden = !a.fixed && a.id in overrides;
              return (
                <SettingRow key={a.id} label={a.label} hint={a.note}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                    {conflict && (
                      <span title="This combo is bound to more than one action" style={{ display: 'flex', color: 'var(--danger)' }}>
                        <AlertTriangle size={14} />
                      </span>
                    )}
                    <span style={comboPill(conflict)}>
                      {isRecording ? 'Press keys…' : formatCombo(resolved[a.id])}
                    </span>
                    {a.fixed ? (
                      <span style={{ fontSize: 'var(--t-tiny)', color: 'var(--fg-3)', minWidth: 70 }}>Not editable</span>
                    ) : (
                      <>
                        <button
                          style={{ ...actionBtn, ...(isRecording ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : {}) }}
                          onClick={() => setRecording(isRecording ? null : a.id)}
                        >
                          {isRecording ? 'Cancel' : 'Record'}
                        </button>
                        <button
                          style={{ ...actionBtn, opacity: overridden ? 1 : 0.35, cursor: overridden ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4 }}
                          disabled={!overridden}
                          title="Reset to default"
                          onClick={() => overridden && resetOne(a.id)}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </SettingRow>
              );
            })}
          </Section>
        );
      })}

      <div style={{ marginTop: 'var(--s-4)' }}>
        <button style={{ ...actionBtn, opacity: hasOverrides ? 1 : 0.35, cursor: hasOverrides ? 'pointer' : 'default' }} disabled={!hasOverrides} onClick={resetAll}>
          Reset all to defaults
        </button>
      </div>
    </div>
  );
}
