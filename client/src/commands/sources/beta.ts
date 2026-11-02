import { FlaskConical } from 'lucide-react';
import type { AppConfig } from '@argus/shared';
import { BETA_FEATURES, isBetaEnabled } from '../../utils/betaFlags.js';
import type { Command } from '../types.js';
import type { CommandContext } from './context.js';

/**
 * "Beta: Enable <feature>" / "Beta: Disable <feature>" for every beta flag;
 * only the one that changes something shows. Enabling toasts the feature's
 * HOW line, since the point of turning it on is finding it next.
 */
export function betaSource(ctx: CommandContext): Command[] {
  return BETA_FEATURES.flatMap((f): Command[] => {
    const on = isBetaEnabled(ctx.config, f.flag);
    const keywords = `beta experimental labs ${f.ref} ${f.description}`;
    return [
      {
        id: `beta:${f.flag}:on`,
        title: `Beta: Enable ${f.label}`,
        category: 'Beta',
        hint: f.ref,
        keywords,
        icon: FlaskConical,
        source: 'beta',
        when: !on,
        run: () => {
          ctx.updateConfig({ [f.flag]: true } as Partial<AppConfig>);
          ctx.toast(`${f.label} on · ${f.how}`, 'ok');
        },
      },
      {
        id: `beta:${f.flag}:off`,
        title: `Beta: Disable ${f.label}`,
        category: 'Beta',
        hint: f.ref,
        keywords,
        icon: FlaskConical,
        source: 'beta',
        when: on,
        run: () => ctx.updateConfig({ [f.flag]: false } as Partial<AppConfig>),
      },
    ];
  });
}
