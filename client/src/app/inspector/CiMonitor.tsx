import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink } from 'lucide-react';
import type { PrCheckCounts, SessionPr } from '@argus/shared';
import { Icon, scaledPx } from '../../components/primitives/index.js';
import { SuppressWhileMounted } from '../../hooks/useOverlaySuppression.js';
import { usePopoverDismiss } from '../../hooks/usePopoverDismiss.js';
import { openExternal } from '../../utils/openExternal.js';
import { PR_CI_LABEL, ciSummary, prChecksUrl } from '../../utils/prFormat.js';

/** Gap between the dot and the popover, and the popover's margin from the window edge. */
const GAP = 4;
const EDGE = 8;

/** Count rows in the popover, with the dot color each one takes. */
const OUTCOMES: { key: keyof PrCheckCounts; label: string; ci: string }[] = [
  { key: 'failed', label: 'Failed', ci: 'failure' },
  { key: 'pending', label: 'Pending', ci: 'pending' },
  { key: 'passed', label: 'Passed', ci: 'success' },
  { key: 'skipped', label: 'Skipped', ci: 'skipped' },
];

/**
 * C1: the checks state of one open PR row — a status dot and label whose
 * tooltip sums the checks up. Clicking opens the CI monitoring popover. A PR
 * with no checks shows a plain label.
 */
export function CiStatus({ pr }: { pr: SessionPr }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (pr.ci === 'none') return <span className="argus-inspector-ci" data-ci="none">{PR_CI_LABEL.none}</span>;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="argus-inspector-ci argus-inspector-ci-btn"
        data-ci={pr.ci}
        title={ciSummary(pr)}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="argus-pr-ci" data-ci={pr.ci} aria-hidden />
        {PR_CI_LABEL[pr.ci]}
      </button>
      {open && <CiPopover pr={pr} anchor={anchor} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Counts per outcome, every failed check with a link to its details page, and
 * the PR's checks tab on GitHub. Portalled to <body> (the inspector scrolls and
 * clips); closes on Escape, a click outside, or a scroll / resize that would
 * leave it behind its dot (usePopoverDismiss).
 */
export function CiPopover({ pr, anchor, onClose }: { pr: SessionPr; anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // The dot toggles the popover itself, so a press on it is not "outside".
  usePopoverDismiss(true, [ref, anchor], ref, (reason) => {
    onClose();
    if (reason === 'escape') anchor.current?.focus();
  });

  // Under the dot, or above it when the window has more room there; measured
  // before paint so it never flashes at the wrong spot. Placed again on every
  // render: the list poll can grow the popover (more failed checks) while open.
  useLayoutEffect(() => {
    const el = ref.current;
    const a = anchor.current?.getBoundingClientRect();
    if (!el || !a) return;
    const { width, height } = el.getBoundingClientRect();
    const below = window.innerHeight - a.bottom - GAP - EDGE;
    const up = height > below && a.top - GAP - EDGE > below;
    el.style.left = `${Math.max(EDGE, Math.min(a.left, window.innerWidth - width - EDGE))}px`;
    el.style.top = `${Math.max(EDGE, up ? a.top - GAP - height : a.bottom + GAP)}px`;
    el.style.visibility = 'visible';
  });

  const counts = pr.checks?.counts;
  const failed = pr.checks?.failed ?? [];
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="CI monitoring"
      className="argus-ci-popover"
      style={{ width: scaledPx(280) }}
    >
      <SuppressWhileMounted target={() => ref.current?.getBoundingClientRect() ?? null} />
      <div className="argus-ci-popover-head">
        <span className="eyebrow">CI monitoring</span>
        <span className="argus-ci-popover-summary">{ciSummary(pr).replace(/^CI: /, '')}</span>
      </div>
      {counts ? (
        <ul className="argus-ci-popover-counts" aria-label="Checks by outcome">
          {OUTCOMES.map(({ key, label, ci }) => (
            <li key={key} data-outcome={key} data-zero={counts[key] === 0 ? '' : undefined}>
              <span className="argus-pr-ci" data-ci={ci} aria-hidden />
              <span>{label}</span>
              <span className="argus-ci-popover-count">{counts[key]}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="argus-ci-popover-empty">{PR_CI_LABEL[pr.ci]}</div>
      )}
      {failed.length > 0 && (
        <>
          <div className="eyebrow argus-ci-popover-sub">Failed checks</div>
          <ul className="argus-ci-popover-failed" aria-label="Failed checks">
            {failed.map((check, i) => (
              <li key={`${i}:${check.name}`}>
                {check.url ? (
                  <button type="button" className="argus-ci-popover-link" title={`Open ${check.name}`} onClick={() => openExternal(check.url!)}>
                    <span className="argus-ci-popover-name">{check.name}</span>
                    <Icon icon={ExternalLink} size={11} strokeWidth={1.8} />
                  </button>
                ) : (
                  <span className="argus-ci-popover-name">{check.name}</span>
                )}
              </li>
            ))}
          </ul>
          {counts && counts.failed > failed.length && (
            <div className="argus-ci-popover-empty">and {counts.failed - failed.length} more</div>
          )}
        </>
      )}
      <button type="button" className="argus-ci-popover-open" onClick={() => { onClose(); openExternal(prChecksUrl(pr.url)); }}>
        <Icon icon={ExternalLink} size={12} strokeWidth={1.8} />
        Open checks on GitHub
      </button>
    </div>,
    document.body,
  );
}
