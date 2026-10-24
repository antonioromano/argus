import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { SessionInfo } from '@argus/shared';
import type { UsageMeterState } from '../../utils/usageFormat.js';

/** What every inspector section gets besides the session it describes. */
export interface InspectorContext {
  /** Usage meter view + plan usage; null while the meter is off in Settings. */
  usageMeter: UsageMeterState | null;
  /** Settings → Shell header → Pull request status. */
  prStatusEnabled: boolean;
  /** Open the Diff for a session, optionally on one file. */
  onOpenDiff: (sessionId: string, file?: string) => void;
}

export interface InspectorSectionProps {
  session: SessionInfo;
  ctx: InspectorContext;
}

/**
 * One collapsible block of the Session Inspector. Sections are declared in
 * `sections.tsx` and rendered in that order; adding one is adding an entry
 * there — the container, the collapse state (persisted by `id` in
 * AppConfig.inspectorCollapsed) and both placements come for free.
 */
export interface InspectorSectionDef {
  /** Stable slug, persisted in AppConfig.inspectorCollapsed (`[a-z][a-z0-9-]*`). */
  id: string;
  title: string;
  icon: LucideIcon;
  /** One-line glance shown on the header while collapsed, so a closed section still says something. */
  Glance?: ComponentType<InspectorSectionProps>;
  /** Mounted only while the section is open, so a closed one costs nothing (no polling). */
  Body: ComponentType<InspectorSectionProps>;
}
