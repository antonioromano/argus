import { AlertTriangle } from 'lucide-react';
import type { AgentDefinition } from '@argus/shared';
import { ErrorActions, Icon } from '../../components/primitives/index.js';
import type { ErrorAction } from '../../errors/errorActions.js';

interface AgentPreflightNoticeProps {
  /** The selected agent, as the create sheet knows it. */
  agent: AgentDefinition;
  /** Install page from the server's detection (custom agents may have one). */
  installUrl?: string;
}

/**
 * The create sheet's warning that the selected agent's command isn't on the
 * server's PATH (plan 2026-10-29-003, D5). A warning, never a gate: the login
 * shell the session runs in can see a PATH `which` on the server can't, so
 * Start stays enabled. Primary action: copy the install command.
 */
export function AgentPreflightNotice({ agent, installUrl }: AgentPreflightNoticeProps) {
  const actions: ErrorAction[] = [
    ...(agent.installCommand ? [{ kind: 'copy-command' as const, command: agent.installCommand }] : []),
    ...(installUrl ? [{ kind: 'open-url' as const, url: installUrl, label: 'Open install page' }] : []),
    { kind: 'open-settings', pane: 'agents' },
  ];
  return (
    <div className="argus-preflight-notice" role="status" data-testid="agent-preflight">
      <div className="argus-preflight-notice-title">
        <Icon icon={AlertTriangle} size="sm" />
        <span>{agent.command} isn’t on your PATH</span>
      </div>
      <div>Argus couldn’t find {agent.name}. Install it, or set its command in Settings → Agents. You can still start the session.</div>
      <ErrorActions actions={actions} />
    </div>
  );
}
