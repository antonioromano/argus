import { Badge, Section, Toggle } from '../../../../components/primitives/index.js';
import { BETA_FEATURES, isBetaEnabled } from '../../../../utils/betaFlags.js';
import type { PaneProps } from '../types.js';

/**
 * Opt-in switches for experimental features. Every flag ships off, and an off
 * feature is inert (no UI, no polling, no timers). Features that have not
 * shipped yet are listed but locked off with a "coming soon" tag, so a user
 * can never turn on something that does nothing.
 */
export function BetaPane({ config, onSave }: PaneProps) {
  return (
    <Section title="Beta features">
      {BETA_FEATURES.map((f) => {
        const on = f.available && isBetaEnabled(config, f.flag);
        return (
          <div key={f.flag} className="setting-row" data-testid={`beta-${f.flag}`} data-available={f.available}>
            <div className="setting-row-meta">
              <div className="setting-row-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                <span>{f.label}</span>
                <Badge label="Beta" />
                {!f.available && <Badge label="Coming soon" color="var(--fg-3)" />}
              </div>
              <div className="setting-row-hint">{f.description}</div>
            </div>
            <div style={{ flexShrink: 0 }}>
              <Toggle
                checked={on}
                disabled={!f.available}
                onChange={(v) => { if (f.available) void onSave({ [f.flag]: v }); }}
              />
            </div>
          </div>
        );
      })}
    </Section>
  );
}
