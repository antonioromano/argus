import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo } from '@argus/shared';
import { onDiscovery, type DiscoveryEvent } from './discoveryEvents.js';
import { markTipSeen, markUsed, resetTips as clearTips, tipAllowed } from './discoveryState.js';
import { TIPS, nextTip, tipById, type TipDef } from './tips.js';
import type { DiscoveryApi } from './useDiscovery.js';

/** How long a create / deep-scroll still counts as "just happened": the session
 *  list that makes a create meaningful arrives over the socket a moment later. */
export const EVENT_WINDOW_MS = 10_000;

export interface UseTipsArgs {
  disc: DiscoveryApi;
  showTips: boolean;
  /** Sessions this window owns that have not exited. */
  sessions: readonly Pick<SessionInfo, 'id' | 'status' | 'folderPath'>[];
  /** A sheet, palette or settings is open: never cover it, try again later. */
  overlayOpen: boolean;
  introPending: boolean;
  isMainWindow: boolean;
  /** Another discovery surface (the notification ask) holds the card slot. */
  slotBusy?: boolean;
  /** Overridable for tests. */
  now?: () => number;
  hasFocus?: () => boolean;
}

export interface TipsApi {
  current: TipDef | null;
  /** Close the shown tip. It is already spent: it was marked seen at show time. */
  dismiss: () => void;
  /** Plan 001 hook: show this tip now, past the rate limit (not past main-window). */
  showTip: (id: string) => void;
  /** Plan 001 hook / "Show tips again": forget which tips were shown. */
  resetTips: () => void;
}

/**
 * The tips engine: listens for discovery events and session changes, and shows
 * at most one tip per launch and none within an hour of the last (persisted),
 * never over an overlay or the intro, never in an unfocused or secondary
 * window. A tip that can't show now is not queued; the next qualifying signal
 * re-evaluates. "Used" markers are recorded even with tips off — the checklist
 * reads them too.
 */
export function useTips(args: UseTipsArgs): TipsApi {
  const [current, setCurrent] = useState<TipDef | null>(null);
  const shownThisLaunch = useRef(0);
  const recent = useRef<{ event: DiscoveryEvent; at: number } | null>(null);

  const live = useRef(args);
  useEffect(() => { live.current = args; });
  const currentRef = useRef(current);
  useEffect(() => { currentRef.current = current; }, [current]);

  const show = useCallback((tip: TipDef) => {
    const { disc, now = Date.now } = live.current;
    shownThisLaunch.current += 1;
    recent.current = null;
    setCurrent(tip);
    // Spent at show time: a crash mid-read must never re-show it.
    void disc.patch((s) => markTipSeen(s, tip.id, now()));
  }, []);

  const evaluate = useCallback(() => {
    const a = live.current;
    const now = (a.now ?? Date.now)();
    const hasFocus = a.hasFocus ?? (() => document.hasFocus());
    if (!a.isMainWindow || currentRef.current || a.slotBusy || a.overlayOpen || a.introPending) return;
    if (!hasFocus()) return;
    if (!tipAllowed(a.disc.discovery, { now, shownThisLaunch: shownThisLaunch.current, showTips: a.showTips })) return;
    const lastEvent = recent.current && now - recent.current.at < EVENT_WINDOW_MS ? recent.current.event : undefined;
    const tip = nextTip(TIPS, { sessions: a.sessions, lastEvent }, a.disc.discovery);
    if (tip) show(tip);
  }, [show]);

  useEffect(() => onDiscovery((e) => {
    if (e.type === 'used') {
      void live.current.disc.patch((s) => markUsed(s, e.marker));
      return;
    }
    recent.current = { event: e, at: (live.current.now ?? Date.now)() };
    evaluate();
  }), [evaluate]);

  // Session list, overlay and intro changes are all chances to show a tip that
  // was blocked a moment ago.
  useEffect(() => { evaluate(); }, [evaluate, args.sessions, args.overlayOpen, args.introPending, args.slotBusy]);

  const dismiss = useCallback(() => setCurrent(null), []);

  const showTip = useCallback((id: string) => {
    const tip = tipById(id);
    if (tip && live.current.isMainWindow) show(tip);
  }, [show]);

  const resetTips = useCallback(() => {
    void live.current.disc.patch(clearTips);
  }, []);

  return { current, dismiss, showTip, resetTips };
}
