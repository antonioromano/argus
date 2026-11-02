import { useEffect, useState } from 'react';
import type { AppInfo } from '@argus/shared';
import { Button, Row, Sheet, Stack, Text } from '../../components/primitives/index.js';
import { openExternal } from '../../utils/openExternal.js';
import type { ElectronHelpBridge } from '../../utils/platform.js';
import appIcon from '../intro/assets/app-icon-default.webp';

interface AboutSheetProps {
  /** The version the update service reports; shown until main answers (and outside Electron). */
  version?: string;
  onClose: () => void;
  onWhatsNew: () => void;
  onCopyDiagnostics: () => void;
  onCheckForUpdates: () => void;
  /** Injected for tests; defaults to the preload bridge. */
  bridge?: ElectronHelpBridge;
}

function buildLine(info: AppInfo | null): string {
  if (!info) return 'dev build';
  if (!info.build) return info.packaged ? 'build unknown' : 'dev build';
  const date = info.build.builtAt ? ` · ${info.build.builtAt.slice(0, 10)}` : '';
  return `build ${info.build.sha}${info.build.dirty ? ' (modified)' : ''}${date}`;
}

/**
 * Argus' own About sheet (App menu → About Argus; plan 002). Replaces the
 * native panel, which can hold neither links nor buttons.
 */
export function AboutSheet({ version, onClose, onWhatsNew, onCopyDiagnostics, onCheckForUpdates, bridge = window.electronHelp }: AboutSheetProps) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let live = true;
    bridge?.appInfo().then((i) => { if (live) setInfo(i); }).catch(() => {});
    return () => { live = false; };
  }, [bridge]);

  const shownVersion = info?.appVersion ?? version;
  const links = info ? [
    { label: 'Release Notes', url: info.links.releases },
    { label: 'Documentation', url: info.links.docs },
    { label: 'GitHub', url: info.links.repo },
    { label: 'License', url: info.links.license },
  ] : [];

  return (
    <Sheet
      eyebrow="About"
      width={420}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onCopyDiagnostics}>Copy Diagnostics</Button>
          <Button onClick={onCheckForUpdates}>Check for Updates…</Button>
          <Button variant="primary" onClick={onWhatsNew}>What’s New</Button>
        </>
      )}
    >
      <Stack gap={3} align="center" style={{ textAlign: 'center' }}>
        <img src={appIcon} alt="" width={96} height={96} draggable={false} />
        <Text as="div" size="title" weight={600} tone="default">Argus</Text>
        <Stack gap={1} align="center">
          <Text as="div" size="body">{shownVersion ? `Version ${shownVersion}` : 'Version unknown'}</Text>
          <Text as="div" size="caption" tone="faint" mono>{buildLine(info)}</Text>
          {info && (
            <Text as="div" size="caption" tone="faint">
              {`Electron ${info.electron} · Chromium ${info.chrome} · Node ${info.node} · macOS ${info.macos} (${info.arch})`}
            </Text>
          )}
        </Stack>
        {links.length > 0 && (
          <Row gap={3} justify="center" wrap>
            {links.map((l) => (
              <Button key={l.label} variant="ghost" size="sm" onClick={() => openExternal(l.url)}>{l.label}</Button>
            ))}
          </Row>
        )}
        <Text as="div" size="caption" tone="faint">{`© ${new Date().getFullYear()} Antonio Romano · MIT License`}</Text>
      </Stack>
    </Sheet>
  );
}
