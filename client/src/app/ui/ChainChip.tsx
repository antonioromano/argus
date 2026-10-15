import { Tooltip } from '../../components/primitives/index.js';

/**
 * Beta F13: "⛓ N" on a tile header — N chains fire from this shell. ArgusApp
 * passes a count only while `betaSessionChains` is on, so with the flag off
 * (or no chains) this renders nothing. Fixed size: hover changes nothing.
 */
export function ChainChip({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <Tooltip content={`${count} chain${count === 1 ? '' : 's'} from this shell (Settings → Beta features)`}>
      <span className="argus-tile-chain" data-testid="chain-chip" aria-label={`${count} chain${count === 1 ? '' : 's'}`}>
        ⛓ {count}
      </span>
    </Tooltip>
  );
}
