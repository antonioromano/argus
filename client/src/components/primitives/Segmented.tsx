/* ===== Segmented — one-of-N picker for short, self-evident options =====
 *
 * Settings grew three hand-rolled copies of this control (theme, running
 * indicator, waiting style), each with its own copy of the same style object.
 * This is that control, once. Use it when every option is legible from a word
 * or two; when an option needs a sentence to justify itself, use radio cards
 * (see EngineChoice) instead.
 */
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** Native title text — for the rare option that benefits from a hover gloss. */
  title?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (next: T) => void;
  /** Accessible group name. */
  label: string;
  /** Drop the 64px per-option floor — for 3+ options that must fit one row. */
  compact?: boolean;
  disabled?: boolean;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  compact = false,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 'var(--s-2)' }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            style={{
              all: 'unset',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              padding: compact ? '6px var(--s-2)' : '6px var(--s-3)',
              minWidth: compact ? 0 : 64,
              textAlign: 'center',
              boxSizing: 'border-box',
              background: on ? 'var(--accent-bg)' : 'var(--bg-1)',
              border: `1px solid ${on ? 'var(--accent-edge)' : 'var(--line-2)'}`,
              borderRadius: 'var(--r-2)',
              fontSize: 'var(--t-sm)',
              color: on ? 'var(--accent)' : 'var(--fg-1)',
              transition: 'background var(--dur-fast), border-color var(--dur-fast)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
