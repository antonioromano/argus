import type { UsageRow } from '../../utils/usageFormat.js';
import { UsageRows } from './UsageChip.js';

/** The name tooltip: its usual hint, then whatever the header has shed. */
export function ShedTooltip({ hint, rows }: { hint: string; rows: readonly UsageRow[] }) {
  if (rows.length === 0) return hint;
  return (
    <span style={{ display: 'grid', gap: 4 }}>
      <span>{hint}</span>
      <UsageRows rows={rows} testId="shed-tooltip" />
    </span>
  );
}
