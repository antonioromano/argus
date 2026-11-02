import { useEffect, useRef, useState } from 'react';
import { Check, Copy, History, Power, RotateCcw, SearchX } from 'lucide-react';
import type { RunMode } from '@argus/shared';
import { Button, Icon, Row, Text } from '../../components/primitives/index.js';
import { isCommandNotFoundExit } from '../../utils/agentExit.js';

/**
 * Laid over an exited session's terminal so the empty screen explains itself
 * and Restart is one click away instead of buried in the ⋯ menu. The parent
 * must be `position: relative`.
 *
 * Not used over an Advanced (native-view) tile: that terminal is a separate
 * macOS window stacked above the page, so anything drawn here would sit
 * underneath it.
 */
export function ExitedCard({
  runMode,
  folderPath,
  onRestart,
  onResume,
  onClone,
  exitCode,
  exitedAfterMs,
  agentCommand,
  installCommand,
}: {
  runMode?: RunMode;
  folderPath: string;
  onRestart: () => void;
  /** Present when the last Claude conversation can be reopened (see canResume). */
  onResume?: () => void;
  onClone?: () => void;
  /** The last run's exit code and how long after spawn it came (see useSessions). */
  exitCode?: number;
  exitedAfterMs?: number;
  /** The agent's CLI command, named in the "couldn't find" variant. */
  agentCommand?: string;
  /** Shell command that installs the agent, when Argus knows one. */
  installCommand?: string;
}) {
  const stoppedWithArgus = runMode === 'direct';
  const notFound = !!agentCommand && isCommandNotFoundExit(exitCode, exitedAfterMs);
  return (
    <div
      data-testid="exited-card"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'color-mix(in srgb, var(--bg-0) 60%, transparent)',
      }}
    >
      <div
        role="status"
        style={{
          width: 'min(78%, 340px)',
          padding: 'var(--s-5)',
          textAlign: 'center',
          background: 'var(--bg-1)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-3)',
          boxShadow: '0 6px 24px rgba(0,0,0,.08)',
        }}
      >
        {notFound ? (
          <NotFoundBody command={agentCommand!} installCommand={installCommand} onRestart={onRestart} />
        ) : (
          <>
            <div aria-hidden style={iconBadge(false)}>
              <Icon icon={Power} size="lg" strokeWidth={2} />
            </div>
            <Text as="div" size="body" weight={600} style={{ color: 'var(--fg-0)' }}>
              {stoppedWithArgus ? 'Session stopped' : 'Agent exited'}
            </Text>
            <Text as="div" size="small" tone="muted" style={{ marginTop: 'var(--s-1)', lineHeight: 1.45 }}>
              {stoppedWithArgus ? 'The agent isn’t running. Sessions using the Native terminal stop when Argus quits.' : 'The agent process has ended.'}
              <br />
              {onResume && <>Resume picks up the last conversation. </>}
              Restart starts a fresh agent in <span style={mono}>{folderPath}</span>.
            </Text>
            <Row align="stretch" justify="center" wrap gap={2} style={{ marginTop: 'var(--s-4)' }}>
              {onResume && <Button variant="primary" size="sm" icon={History} onClick={onResume}>Resume conversation</Button>}
              <Button variant={onResume ? 'outline' : 'primary'} size="sm" icon={RotateCcw} onClick={onRestart}>Restart</Button>
              {onClone && <Button variant="outline" size="sm" onClick={onClone}>Clone…</Button>}
            </Row>
          </>
        )}
      </div>
    </div>
  );
}

const iconBadge = (danger: boolean) => ({
  width: 36,
  height: 36,
  margin: '0 auto 10px',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: danger ? 'var(--danger-bg)' : 'var(--accent-bg)',
  color: danger ? 'var(--danger)' : 'var(--accent)',
});

const mono = { fontFamily: 'var(--font-mono)', wordBreak: 'break-all' as const };

/** Exit 127 right after spawn: the shell couldn't find the agent's command. */
function NotFoundBody({ command, installCommand, onRestart }: { command: string; installCommand?: string; onRestart: () => void }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = () => {
    if (!installCommand) return;
    void navigator.clipboard.writeText(installCommand).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  return (
    <>
      <div aria-hidden style={iconBadge(true)}>
        <Icon icon={SearchX} size="lg" strokeWidth={2} />
      </div>
      <Text as="div" size="body" weight={600} style={{ color: 'var(--fg-0)' }}>
        Couldn’t find <span style={mono}>{command}</span>
      </Text>
      <Text as="div" size="small" tone="muted" style={{ marginTop: 'var(--s-1)', lineHeight: 1.45 }}>
        The session ended right after it started, with exit code 127 (command not found).
        <br />
        {installCommand
          ? <>Install it, then restart:</>
          : <>Check that <span style={mono}>{command}</span> is installed and on your PATH, then restart.</>}
      </Text>
      {installCommand && (
        <code
          style={{
            display: 'block',
            marginTop: 'var(--s-2)',
            padding: 'var(--s-1-5) var(--s-2)',
            textAlign: 'left',
            fontSize: 'var(--t-xs)',
            color: 'var(--fg-1)',
            background: 'var(--bg-inset)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-2)',
            ...mono,
          }}
        >
          {installCommand}
        </code>
      )}
      <Row align="stretch" justify="center" wrap gap={2} style={{ marginTop: 'var(--s-4)' }}>
        {installCommand && (
          <Button variant="primary" size="sm" icon={copied ? Check : Copy} onClick={copy}>
            {copied ? 'Copied' : 'Copy install command'}
          </Button>
        )}
        <Button variant={installCommand ? 'outline' : 'primary'} size="sm" icon={RotateCcw} onClick={onRestart}>Restart</Button>
      </Row>
    </>
  );
}
