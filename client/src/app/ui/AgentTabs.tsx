import { AgentGlyph } from './AgentGlyph.js';

interface AgentOption { id: string; name: string }

/**
 * Agent picker as tabs, the same underline style as TerminalChoice so the two
 * choices in the New / Clone sheets read as one family. Wraps when custom
 * agents push past one row.
 */
export function AgentTabs({
  agents,
  value,
  onChange,
}: {
  agents: readonly AgentOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Agent" style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--line-2)' }}>
      {agents.map((a) => {
        const on = value === a.id;
        return (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(a.id)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '7px 12px',
              marginBottom: -1,
              fontSize: 'var(--t-sm)',
              fontWeight: on ? 600 : 400,
              color: on ? 'var(--fg-0)' : 'var(--fg-2)',
              borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <AgentGlyph agent={a.id} size={16} />
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
