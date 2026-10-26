import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import type { InspectorSide, SessionInfo } from '@argus/shared';
import { Icon, Tooltip } from '../../components/primitives/index.js';
import { PanelSideGlyph } from '../ui/PanelSideGlyph.js';
import { AgentGlyph } from '../ui/AgentGlyph.js';
import { shellLabel } from '../../utils/sessionLabel.js';
import { INSPECTOR_SECTIONS } from './sections.js';
import type { InspectorContext, InspectorSectionDef } from './types.js';

export interface SessionInspectorProps {
  /** The session to describe; null shows the placeholder. */
  session: SessionInfo | null;
  /** 'column' docks on the right of the work area, 'sidebar' sits in the left rail (stacked layout). */
  placement: 'column' | 'sidebar';
  /** Ids of the collapsed sections (AppConfig.inspectorCollapsed). */
  collapsed: readonly string[];
  onToggleSection: (id: string) => void;
  /** Where it sits now; the header button moves it to the other side. */
  side: InspectorSide;
  onSwitchSide: () => void;
  /** Shown when no session is selected. */
  placeholder?: string;
  ctx: InspectorContext;
  /** Override the section list (tests). */
  sections?: readonly InspectorSectionDef[];
}

function Section({ def, session, ctx, open, onToggle }: {
  def: InspectorSectionDef;
  session: SessionInfo;
  ctx: InspectorContext;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = useId();
  return (
    <section className="argus-inspector-section" data-section={def.id} data-open={open || undefined}>
      <button
        type="button"
        className="argus-inspector-section-head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <Icon icon={def.icon} size={12} strokeWidth={1.8} />
        <span className="argus-inspector-section-title">{def.title}</span>
        <Icon icon={ChevronDown} size={11} strokeWidth={2} className="argus-inspector-chevron" />
        {!open && def.Glance && <span className="argus-inspector-section-summary"><def.Glance session={session} ctx={ctx} /></span>}
      </button>
      {open && (
        <div id={bodyId} className="argus-inspector-section-body">
          <def.Body session={session} ctx={ctx} />
        </div>
      )}
    </section>
  );
}

/**
 * Session Inspector: what the shell header used to cram into chips (usage,
 * git, GitHub), as collapsible cards with room for the detail. The same
 * component renders in both placements (left sidebar, right column).
 * The header only offers the side switch; showing and hiding live in the
 * toolbar, ⌘I, the palette and Settings, so the narrow header keeps its room.
 */
export function SessionInspector({
  session,
  placement,
  collapsed,
  onToggleSection,
  side,
  onSwitchSide,
  placeholder = 'Select a shell to inspect it.',
  ctx,
  sections = INSPECTOR_SECTIONS,
}: SessionInspectorProps) {
  return (
    <div className="argus-inspector" data-placement={placement} data-testid="session-inspector">
      <div className="argus-inspector-head">
        {/* The header names the shell being described; the cards name their content. */}
        {session && (
          <>
            <AgentGlyph agent={session.agentType} size={14} />
            <span className="argus-inspector-session" title={session.folderPath}>{shellLabel(session)}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        <Tooltip content={side === 'left' ? 'Move inspector to the right' : 'Move inspector to the left'}>
          <button
            type="button"
            className="argus-inspector-side-btn"
            aria-label={side === 'left' ? 'Move inspector to the right' : 'Move inspector to the left'}
            onClick={onSwitchSide}
          >
            <PanelSideGlyph side={side === 'left' ? 'right' : 'left'} size={13} />
          </button>
        </Tooltip>
      </div>
      {session ? (
        <div className="argus-inspector-scroll">
          {sections.map((def) => (
            <Section
              key={def.id}
              def={def}
              session={session}
              ctx={ctx}
              open={!collapsed.includes(def.id)}
              onToggle={() => onToggleSection(def.id)}
            />
          ))}
        </div>
      ) : (
        <div className="argus-inspector-placeholder">{placeholder}</div>
      )}
    </div>
  );
}
