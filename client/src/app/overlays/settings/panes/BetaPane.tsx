import { useContext } from 'react';
import { Badge, Section, Toggle, Row, Text } from '../../../../components/primitives/index.js';
import { BETA_FEATURES, isBetaEnabled } from '../../../../utils/betaFlags.js';
import type { PaneProps } from '../types.js';
import { ChainsSection } from './ChainsSection.js';
import { SettingTargetContext, settingAnchorProps } from '../settingTarget.js';
import { docsUrl } from '../../../../constants/docs.js';
import { openExternal } from '../../../../utils/openExternal.js';

/**
 * Opt-in switches for experimental features. Every flag ships off, and an off
 * feature is inert (no UI, no polling, no timers). With session chains (F13)
 * on, their list and recent fires show below the switches.
 */
export function BetaPane({ config, onSave }: PaneProps) {
  const target = useContext(SettingTargetContext);
  return (
    <>
      <Section title="Beta features">
        {BETA_FEATURES.map((f) => (
          <div
            key={f.flag}
            {...settingAnchorProps(`beta:${f.flag}`, target === `beta:${f.flag}`, 'setting-row')}
            data-testid={`beta-${f.flag}`}
          >
            <div className="setting-row-meta">
              <Row gap={2} className="setting-row-label">
                <span>{f.label}</span>
                <Badge label="Beta" />
                <button
                  type="button"
                  className="setting-learn-more"
                  data-testid={`beta-docs-${f.flag}`}
                  onClick={() => openExternal(docsUrl(`/beta/${f.docsSlug}/`))}
                >
                  Learn more
                </button>
              </Row>
              <div className="setting-row-hint">{f.description}</div>
              <Row
                align="baseline"
                gap={1.5}
                data-testid={`beta-how-${f.flag}`}
                style={{
                  marginTop: 'var(--s-1-5)',
                  fontSize: 'var(--t-tiny)',
                  color: 'var(--fg-1)',
                }}
              >
                <Text mono size="eyebrow" weight={600} tone="faint" style={{ flexShrink: 0, letterSpacing: '.06em' }}>HOW</Text>
                <span>{f.how}</span>
              </Row>
              {f.caveats.length > 0 && (
                <Row align="stretch" gap={1.5} wrap style={{ marginTop: 'var(--s-1-5)' }}>
                  {f.caveats.map((c) => <CaveatChip key={c.text} text={c.text} warn={c.warn} />)}
                </Row>
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
        padding: '0 var(--s-2)',
        borderRadius: 'var(--r-4)',
        whiteSpace: 'nowrap',
        background: warn ? 'var(--warn-bg)' : 'var(--bg-3)',
        color: warn ? 'var(--warn)' : 'var(--fg-2)',
      }}
    >
      {text}
    </span>
  );
}
