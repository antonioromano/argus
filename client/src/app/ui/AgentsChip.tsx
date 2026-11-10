import { Bot } from 'lucide-react';
import { Icon } from '../../components/primitives/index.js';

/**
 * "N agents": how many helpers a Claude session is running right now. Renders
 * nothing at 0. A button when `onClick` is given (opens the roster), else a span.
 * Fixed content, hover recolors only, so it never reflows the row it sits in.
 */
export function AgentsChip({ count, onClick }: { count: number; onClick?: () => void }) {
  if (count <= 0) return null;
  const body = (
    <>
      <Icon icon={Bot} size="xs" strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>{count} {count === 1 ? 'agent' : 'agents'}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className="argus-agents-chip"
        data-testid="agents-chip"
        title="Running agents"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {body}
      </button>
    );
  }
  return <span className="argus-agents-chip" data-testid="agents-chip" title="Running agents">{body}</span>;
}
