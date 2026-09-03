import type { TerminalEngine } from '@argus/shared';
import { ENGINE_LABEL, ENGINE_HINT } from './terminalEngineCopy.js';

const ORDER: TerminalEngine[] = ['web', 'native'];

/**
 * Radio cards rather than segmented buttons: both options carry real
 * trade-offs, and a segmented control has room to explain neither. Each option
 * states its own case so the unselected one is never the unexplained one.
 */
export function EngineChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: TerminalEngine;
  onChange: (v: TerminalEngine) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Terminal engine"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
    >
      {ORDER.map((v) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(v)}
            style={{
              all: 'unset',
              display: 'flex',
              gap: 9,
              padding: '9px 11px',
              cursor: disabled ? 'default' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              background: on ? 'var(--accent-bg)' : 'var(--bg-1)',
              border: `1px solid ${on ? 'var(--accent-edge)' : 'var(--line-2)'}`,
              borderRadius: 'var(--r-2)',
              boxSizing: 'border-box',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 13,
                height: 13,
                flex: '0 0 auto',
                marginTop: 2,
                borderRadius: '50%',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--fg-3)'}`,
                position: 'relative',
                display: 'block',
              }}
            >
              {on && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 3,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    display: 'block',
                  }}
                />
              )}
            </span>
            <span style={{ display: 'block' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 'var(--t-sm)',
                  fontWeight: 500,
                  color: on ? 'var(--accent)' : 'var(--fg-0)',
                }}
              >
                {ENGINE_LABEL[v]}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: 2,
                  fontSize: 'var(--t-xs)',
                  lineHeight: 1.5,
                  color: 'var(--fg-2)',
                }}
              >
                {ENGINE_HINT[v]}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
