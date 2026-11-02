import { useEffect, useMemo } from 'react';
import { ListChecks, Lightbulb } from 'lucide-react';
import type { AppConfig, SessionInfo } from '@argus/shared';
import { Button } from '../../components/primitives/index.js';
import { formatCombo } from '../../keyboard/combo.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';
import { TipCard } from './TipCard.js';
import { useTips } from './useTips.js';
import { useNotificationAsk } from './useNotificationAsk.js';
import { ASK_COPY } from './notificationAsk.js';
import { openChecklist, registerDiscoveryCommands, resetTips as resetAllTips } from './discoveryCommands.js';
import { useRegisterCommands } from '../../commands/registry.js';
import type { Command } from '../../commands/types.js';
import type { TipAction } from './tips.js';
import type { DiscoveryApi } from './useDiscovery.js';

export interface DiscoveryHostProps {
  disc: DiscoveryApi;
  config: AppConfig | null;
  updateConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  sessions: readonly SessionInfo[];
  ownsSession: (id: string) => boolean;
  overlayOpen: boolean;
  introPending: boolean;
  isMainWindow: boolean;
  shortcuts?: ResolvedShortcuts;
  onTipAction: (action: TipAction) => void;
}

/**
 * The one bottom-left card slot: the notification ask when it fires, else at
 * most one tip. Renders nothing most of the time.
 */
export function DiscoveryHost({
  disc, config, updateConfig, sessions, ownsSession, overlayOpen, introPending, isMainWindow, shortcuts, onTipAction,
}: DiscoveryHostProps) {
  const owned = useMemo(
    () => sessions.filter((s) => s.status !== 'exited' && ownsSession(s.id)),
    [sessions, ownsSession],
  );
  const ask = useNotificationAsk({
    sessions,
    ownsSession,
    notificationsEnabled: config?.notificationsEnabled ?? false,
    disc,
    isMainWindow,
    blocked: overlayOpen || introPending,
    updateConfig,
  });
  const tips = useTips({
    disc,
    showTips: (config?.showTips ?? true) && !!config,
    sessions: owned,
    overlayOpen,
    introPending,
    isMainWindow,
    slotBusy: ask.phase !== null,
  });

  const { showTip, resetTips } = tips;
  useEffect(() => registerDiscoveryCommands({ showTip, resetTips }), [showTip, resetTips]);
  // Palette entries (plan 001's registry). "Show tips" itself is a catalog
  // toggle, so the settings source already lists it.
  const commands = useMemo<readonly Command[]>(() => (isMainWindow ? PALETTE_COMMANDS : []), [isMainWindow]);
  useRegisterCommands('discovery', commands);

  if (ask.phase === 'ask') {
    return (
      <TipCard
        title={ASK_COPY.title}
        body={ASK_COPY.body}
        primary={{ label: ASK_COPY.turnOn, run: ask.turnOn }}
        dismissLabel={ASK_COPY.notNow}
        onClose={(reason) => { if (reason !== 'action') ask.close(); }}
      />
    );
  }
  if (ask.phase === 'followup') {
    return (
      <TipCard
        title="Notifications are on"
        body={ASK_COPY.confirmBody}
        dismissLabel="Done"
        onClose={ask.close}
        footnote={(
          <>
            <span>{ASK_COPY.followup}</span>
            <Button size="sm" variant="outline" onClick={ask.openSystemSettings}>{ASK_COPY.openSettings}</Button>
          </>
        )}
      />
    );
  }

  const tip = tips.current;
  if (!tip) return null;
  const combo = tip.shortcut && shortcuts ? formatCombo(shortcuts[tip.shortcut]) : undefined;
  return (
    <TipCard
      title={tip.title}
      body={tip.body}
      combo={combo}
      primary={{ label: tip.primaryLabel, run: () => onTipAction(tip.action) }}
      onClose={tips.dismiss}
      onDisableAll={() => { void updateConfig({ showTips: false }); }}
    />
  );
}

const PALETTE_COMMANDS: readonly Command[] = [
  {
    id: 'tips:checklist',
    title: 'Getting started checklist',
    category: 'Help',
    keywords: 'onboarding checklist getting started tour first run',
    icon: ListChecks,
    source: 'tips',
    run: openChecklist,
  },
  {
    id: 'tips:reset',
    title: 'Show tips again',
    category: 'Help',
    keywords: 'tips hints reset onboarding discovery',
    icon: Lightbulb,
    source: 'tips',
    run: resetAllTips,
  },
];
