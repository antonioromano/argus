import type { UsageRow } from '../../utils/usageFormat.js';

/** The name tooltip: its usual hint, then whatever the header has shed. */
export function ShedTooltip({ hint, rows }: { hint: string; rows: readonly UsageRow[] }) {
  if (rows.length === 0) return hint;
  return (
    <span style={{ display: 'grid', gap: 4 }}>
      <span>{hint}</span>
      <span className="argus-usage-pop" data-testid="shed-tooltip">
        {rows.map((r, i) => (
          <span key={i} className="argus-usage-pop-row">
            <b>{r.label}</b>
            <span>{r.value}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
