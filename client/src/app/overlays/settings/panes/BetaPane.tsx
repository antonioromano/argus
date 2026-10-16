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
              <div data-testid={`beta-how-${f.flag}`} style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6, fontSize: 'var(--t-tiny)', color: 'var(--fg-1)' }}>
                <span style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--t-micro)', fontWeight: 600, letterSpacing: '.06em', color: 'var(--fg-3)' }}>HOW</span>
                <span>{f.how}</span>
              </div>
              {f.caveats.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                  {f.caveats.map((c) => <CaveatChip key={c.text} text={c.text} warn={c.warn} />)}
                </div>
              )}
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

/** A small static limit note under a beta row; `warn` ones use the warning token. */
function CaveatChip({ text, warn }: { text: string; warn?: boolean }) {
  return (
    <span
      data-testid="beta-caveat"
      data-warn={warn ? 'true' : undefined}
      style={{
        fontSize: 'var(--t-micro)',
        lineHeight: 1.5,
        padding: '0 7px',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        background: warn ? 'var(--warn-bg)' : 'var(--bg-3)',
        color: warn ? 'var(--warn)' : 'var(--fg-2)',
      }}
    >
      {text}
    </span>
  );
}
