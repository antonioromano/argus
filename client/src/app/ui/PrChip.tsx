import type { SessionPr } from '@argus/shared';
import { Tooltip, Icon } from '../../components/primitives/index.js';
import { openExternal } from '../../utils/openExternal.js';
import { describePr, PR_STATE_ICON } from '../../utils/prFormat.js';

/**
 * The session branch's GitHub PR on a shell header: `⇅ #42 ●`, the icon
 * tinted by PR state and the dot by aggregate CI. Opens the PR in the browser.
 * Fixed content — hover recolors only, never resizes the header row.
 */
export function PrChip({ pr }: { pr: SessionPr }) {
  const Glyph = PR_STATE_ICON[pr.state];
  const showCi = (pr.state === 'open' || pr.state === 'draft') && pr.ci !== 'none';
  return (
    <Tooltip content={describePr(pr)}>
      <button
        type="button"
        className="argus-pr"
        data-testid="pr-chip"
        data-state={pr.state}
        aria-label={describePr(pr)}
        onClick={(e) => { e.stopPropagation(); openExternal(pr.url); }}
      >
        <Icon icon={Glyph} size={10} strokeWidth={2} className="argus-pr-icon" style={{ flexShrink: 0 }} />
        <span>#{pr.number}</span>
        {showCi && <span className="argus-pr-ci" data-ci={pr.ci} aria-hidden />}
      </button>
    </Tooltip>
  );
}
