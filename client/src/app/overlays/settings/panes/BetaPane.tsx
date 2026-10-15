import { Badge, Section, Toggle } from '../../../../components/primitives/index.js';
import { BETA_FEATURES, isBetaEnabled } from '../../../../utils/betaFlags.js';
import type { PaneProps } from '../types.js';
import { ChainsSection } from './ChainsSection.js';

/**
 * Opt-in switches for experimental features. Every flag ships off, and an off
 * feature is inert (no UI, no polling, no timers). With session chains (F13)
 * on, their list and recent fires show below the switches.
 */
export function BetaPane({ config, onSave }: PaneProps) {
  return (
    <>
      <Section title="Beta features">
        {BETA_FEATURES.map((f) => (
          <div key={f.flag} className="setting-row" data-testid={`beta-${f.flag}`}>
            <div className="setting-row-meta">
              <div className="setting-row-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                <span>{f.label}</span>
                <Badge label="Beta" />
              </div>
              <div className="setting-row-hint">{f.description}</div>
            </div>
            <div style={{ flexShrink: 0 }}>
              <Toggle checked={isBetaEnabled(config, f.flag)} onChange={(v) => { void onSave({ [f.flag]: v }); }} />
            </div>
          </div>
        ))}
      </Section>
      {isBetaEnabled(config, 'betaSessionChains') && <ChainsSection />}
    </>
  );
}
