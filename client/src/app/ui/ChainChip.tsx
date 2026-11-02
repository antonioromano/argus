import { Tooltip } from '../../components/primitives/index.js';

/**
 * Beta F13: "⛓ N" on a tile header — N follow-up prompts (chains) fire from this shell. ArgusApp
 * passes a count only while `betaSessionChains` is on, so with the flag off
 * (or no chains) this renders nothing. Fixed size: hover changes nothing.
 */
export function ChainChip({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <Tooltip content={`${count} follow-up prompt${count === 1 ? '' : 's'} from this session (Settings → Beta features)`}>
      <span className="argus-tile-chain" data-testid="chain-chip" aria-label={`${count} follow-up prompt${count === 1 ? '' : 's'}`}>
        ⛓ {count}
      </span>
    </Tooltip>
  );
}
