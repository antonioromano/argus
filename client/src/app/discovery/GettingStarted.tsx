import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Circle, ListChecks, X } from 'lucide-react';
import type { NgrokStatus } from '@argus/shared';
import { Icon, Tooltip } from '../../components/primitives/index.js';
import { CHECKLIST_ITEMS, allDone, autoDone, checklistVisible, newlyDone, openChecklistState, type ChecklistId } from './checklist.js';
import { registerDiscoveryCommands } from './discoveryCommands.js';
import type { DiscoveryApi } from './useDiscovery.js';

/** How long "You're set" stays after the last tick. */
export const DONE_LINGER_MS = 4000;

export interface GettingStartedCardProps {
  done: readonly string[];
  /** Just finished: show "You're set" instead of the list. */
  finished?: boolean;
  onAction: (id: ChecklistId) => void;
  onDismiss: () => void;
}

/** The card itself: presentational, no config. */
export function GettingStartedCard({ done, finished = false, onAction, onDismiss }: GettingStartedCardProps) {
  const [open, setOpen] = useState(true);
  const count = CHECKLIST_ITEMS.filter((i) => done.includes(i.id)).length;
  return (
    <section className="argus-checklist" aria-label="Getting started">
      <div className="argus-checklist-head">
        <button
          type="button"
          className="argus-checklist-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon icon={open ? ChevronDown : ChevronRight} size="sm" />
          <span className="eyebrow">Getting started · {count} of {CHECKLIST_ITEMS.length}</span>
        </button>
        <button type="button" aria-label="Hide checklist" className="argus-checklist-x hover-bg-3" onClick={onDismiss}>
          <Icon icon={X} size="sm" />
        </button>
      </div>
      {finished ? (
        <p className="argus-checklist-done-msg">You’re set.</p>
      ) : open && (
        <ul className="argus-checklist-list">
          {CHECKLIST_ITEMS.map((item) => {
            const ticked = done.includes(item.id);
            return (
              <li key={item.id} className="argus-checklist-row" data-done={ticked ? '' : undefined}>
                <Icon icon={ticked ? Check : Circle} size="sm" strokeWidth={ticked ? 2 : undefined} className="argus-checklist-glyph" />
                <span className="argus-checklist-label">{item.label}</span>
                {/* Always rendered (hidden once ticked) so a tick never reflows the row. */}
                <button
                  type="button"
                  className="argus-checklist-act"
                  tabIndex={ticked ? -1 : 0}
                  aria-hidden={ticked || undefined}
                  style={{ visibility: ticked ? 'hidden' : 'visible' }}
                  onClick={() => onAction(item.id)}
                >
                  {item.action}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export interface GettingStartedProps {
  disc: DiscoveryApi;
  isMainWindow: boolean;
  liveCount: number;
  notificationsEnabled: boolean;
  tunnelStatus: NgrokStatus['tunnelStatus'] | undefined;
  onAction: (id: ChecklistId) => void;
  /** The sidebar is collapsed: show a rail button instead of the card. */
  collapsed?: boolean;
  /** Expands the sidebar; the rail button calls it. */
  onExpand?: () => void;
}

/** Collapsed-sidebar stand-in for the card: one rail row that expands the sidebar. */
export function GettingStartedRail({ done, onExpand }: { done: readonly string[]; onExpand?: () => void }) {
  const count = CHECKLIST_ITEMS.filter((i) => done.includes(i.id)).length;
  const label = `Getting started · ${count} of ${CHECKLIST_ITEMS.length}`;
  return (
    <Tooltip content={label}>
      <button type="button" className="argus-sidebar-row argus-checklist-rail" aria-label={label} onClick={onExpand}>
        <Icon icon={ListChecks} size="xl" />
      </button>
    </Tooltip>
  );
}

/**
 * Wiring: ticks items from real signals (main window only, one write per new
 * tick), lingers on "You're set" after the last one, and registers the
 * `openChecklist` command for the palette.
 */
export function GettingStarted({ disc, isMainWindow, liveCount, notificationsEnabled, tunnelStatus, onAction, collapsed = false, onExpand }: GettingStartedProps) {
  const d = disc.discovery;
  const visible = checklistVisible(d);

  useEffect(() => {
    if (!isMainWindow || !visible) return;
    if (!newlyDone({ liveCount, discovery: d, notificationsEnabled, tunnelStatus })) return;
    void disc.patch((cur) => ({
      ...cur,
      checklistDone: autoDone({ liveCount, discovery: cur, notificationsEnabled, tunnelStatus }),
    }));
  }, [disc, d, isMainWindow, visible, liveCount, notificationsEnabled, tunnelStatus]);

  const { patch } = disc;
  useEffect(() => {
    if (!isMainWindow) return;
    return registerDiscoveryCommands({ openChecklist: () => { void patch((cur) => openChecklistState(cur, Date.now())); } });
  }, [patch, isMainWindow]);

  // "You're set": the render that sees the last tick starts a short linger.
  const finishedNow = d.checklistStartedAt > 0 && !d.checklistDismissed && allDone(d);
  const [wasFinished, setWasFinished] = useState(finishedNow);
  const [lingering, setLingering] = useState(false);
  if (finishedNow !== wasFinished) {
    setWasFinished(finishedNow);
    setLingering(finishedNow);
  }
  useEffect(() => {
    if (!lingering) return;
    const t = setTimeout(() => setLingering(false), DONE_LINGER_MS);
    return () => clearTimeout(t);
  }, [lingering]);

  if (!isMainWindow || (!visible && !lingering)) return null;
  // Collapsed: no room for the card, so keep a rail row that leads back to it.
  // "You're set" has nothing to act on, so it doesn't earn a rail row.
  if (collapsed) return visible ? <GettingStartedRail done={d.checklistDone} onExpand={onExpand} /> : null;
  return (
    <GettingStartedCard
      done={d.checklistDone}
      finished={lingering}
      onAction={onAction}
      onDismiss={() => { void disc.patch((cur) => ({ ...cur, checklistDismissed: true })); }}
    />
  );
}
