import { useState, type CSSProperties } from 'react';
import {
  KIND_BADGE,
  KIND_BEST_FOR,
  KIND_COMPARISON,
  KIND_LABEL,
  KIND_SHARED_NOTE,
  KIND_TAGLINE,
  TERMINAL_KINDS,
  type KindCell,
  type TerminalKind,
} from './terminalKind.js';

/**
 * Three tabs (Universal / Advanced / Native), a one-line tagline that is always
 * visible, and a comparison table behind "Show details" — closed by default so
 * the sheet stays short for people who already know what they want.
 */
export function TerminalChoice({
  value,
  onChange,
}: {
  value: TerminalKind;
  onChange: (v: TerminalKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
      <div role="radiogroup" aria-label="Terminal" style={{ display: 'flex', borderBottom: '1px solid var(--line-2)' }}>
        {TERMINAL_KINDS.map((k) => {
          const on = value === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(k)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '7px 12px',
                marginBottom: -1,
                fontSize: 'var(--t-sm)',
                fontWeight: on ? 600 : 400,
                color: on ? 'var(--fg-0)' : 'var(--fg-2)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
              }}
            >
              {KIND_LABEL[k]}
              {KIND_BADGE[k] && (
                <span
                  style={{
                    marginLeft: 5,
                    padding: '0 4px',
                    fontSize: 9,
                    fontWeight: 500,
                    textTransform: 'uppercase',
                    border: '1px solid currentColor',
                    borderRadius: 3,
                    opacity: 0.65,
                    verticalAlign: 1,
                  }}
                >
                  {KIND_BADGE[k]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        style={{
          padding: '10px 12px',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-2)',
          fontSize: 'var(--t-xs)',
        }}
      >
        <div style={{ fontSize: 'var(--t-sm)', fontWeight: 600, color: 'var(--fg-0)' }}>{KIND_TAGLINE[value]}</div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{ all: 'unset', cursor: 'pointer', marginTop: 6, color: 'var(--fg-2)', fontSize: 'var(--t-xs)' }}
        >
          {open ? '▾ Hide details' : '▸ Show details'}
        </button>
        {open && (
          <div style={{ marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th />
                  {TERMINAL_KINDS.map((k) => (
                    <th key={k} style={colStyle(k === value, true)}>{KIND_LABEL[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {KIND_COMPARISON.map((row) => (
                  <tr key={row.label}>
                    <td style={{ padding: '4px 4px', borderTop: '1px solid var(--line-1)', color: 'var(--fg-1)' }}>{row.label}</td>
                    {TERMINAL_KINDS.map((k) => (
                      <td key={k} style={{ ...colStyle(k === value, false), borderTop: '1px solid var(--line-1)' }}>
                        <Cell v={row.cells[k]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, color: 'var(--fg-2)' }}>
              Best for: <b style={{ color: 'var(--fg-0)', fontWeight: 600 }}>{KIND_BEST_FOR[value]}</b>
            </div>
            <div style={{ marginTop: 4, color: 'var(--fg-3)' }}>{KIND_SHARED_NOTE}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function colStyle(selected: boolean, header: boolean): CSSProperties {
  return {
    width: '22%',
    padding: '4px 4px',
    textAlign: 'center',
    fontWeight: header && selected ? 600 : header ? 500 : 400,
    color: header ? (selected ? 'var(--fg-0)' : 'var(--fg-2)') : undefined,
    background: selected ? 'var(--accent-bg)' : undefined,
  };
}

function Cell({ v }: { v: KindCell }) {
  if (v === true) return <span style={{ color: 'var(--ok)', fontWeight: 700 }}>✓</span>;
  if (v === false) return <span style={{ color: 'var(--fg-3)' }}>–</span>;
  return <span style={{ color: v === 'medium' ? 'var(--warn)' : 'var(--ok)' }}>{v}</span>;
}
