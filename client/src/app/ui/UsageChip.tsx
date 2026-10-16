import type { SessionUsage } from '@argus/shared';
import { Tooltip } from '../../components/primitives/index.js';
import { contextLevel, describeUsage, formatTokens } from '../../utils/usageFormat.js';

/**
 * Claude usage meter on a shell header: context used, colored as the window
 * fills. Same chip shape as ShellGitChip.
 */
export function UsageChip({ usage }: { usage: SessionUsage }) {
  const pct = usage.contextPct;
  return (
    <Tooltip content={describeUsage(usage)}>
      <span className="argus-usage" data-testid="usage-chip">
        {pct !== undefined ? (
          <span className="argus-usage-ctx" data-level={contextLevel(pct)}>{Math.round(pct)}%</span>
        ) : (
          <span className="argus-usage-ctx">{formatTokens(usage.totalTokens)}</span>
        )}
      </span>
    </Tooltip>
  );
}
