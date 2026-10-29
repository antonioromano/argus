import { Bell, ExternalLink, RotateCcw } from 'lucide-react';
import { Section, SettingRow, Toggle, Button } from '../../../../components/primitives/index.js';
import type { PaneProps } from '../types.js';
import { SettingField } from '../SettingField.js';
import { normalizeDiscovery, resetTips } from '../../../discovery/discoveryState.js';

/**
 * Rebuilt on Section/SettingRow. This pane used to hand-roll its own card,
 * sub-headers and rows, so it drifted from every other settings surface — the
 * only reason for the fork was the dimming below, which one wrapper handles.
 */
export function NotificationsPane({ config, onSave }: PaneProps) {
  const enabled = config.notificationsEnabled;

  // Native delivery is owned by the main process (preload bridge), NOT the
  // renderer Web Notification API. The button below round-trips through that
  // real path so the user can verify delivery and trigger the macOS auth prompt.
  const bridgeAvailable = typeof window !== 'undefined' && !!window.electronNotifications;
  const sendTest = () => {
    window.electronNotifications?.show({
      // Must be a UUID: the main-process notif:show handler rejects any other id
      // (it's interpolated into terminal-notifier's -execute shell command). A
      // hardcoded 'argus-test' was silently dropped by that guard.
      id: crypto.randomUUID(),
      title: 'Argus',
      subtitle: 'Test',
      body: 'Notification delivery works.',
      sound: config.notificationSound,
    });
  };

  return (
    <>
      <Section title="Delivery">
        <SettingField id="notificationsEnabled">
          <Toggle checked={enabled} onChange={(v) => { void onSave({ notificationsEnabled: v }); }} />
        </SettingField>
      </Section>

      {/* Always rendered, dimmed when the master switch is off: the triggers stay
          visible so their state is never a mystery, but they can't be edited. */}
      <div
        aria-disabled={!enabled}
        style={{
          opacity: enabled ? 1 : 0.35,
          pointerEvents: enabled ? 'auto' : 'none',
          transition: 'opacity var(--dur-base)',
        }}
      >
        <Section title="When to notify">
          <SettingField id="notifyOnWaiting">
            <Toggle
              checked={config.notifyOnWaiting ?? true}
              onChange={(v) => { void onSave({ notifyOnWaiting: v }); }}
            />
          </SettingField>
          <SettingField id="notifyOnDone">
            <Toggle
              checked={config.notifyOnDone ?? false}
              onChange={(v) => { void onSave({ notifyOnDone: v }); }}
            />
          </SettingField>
          <SettingField id="notifyOnPrChecks">
            <Toggle
              checked={config.notifyOnPrChecks ?? true}
              onChange={(v) => { void onSave({ notifyOnPrChecks: v }); }}
            />
          </SettingField>
          <SettingField id="notificationSound">
            <Toggle
              checked={config.notificationSound ?? false}
              onChange={(v) => { void onSave({ notificationSound: v }); }}
            />
          </SettingField>
        </Section>
      </div>

      {/* Outside the dimmed block on purpose — testing delivery is exactly what
          you want when notifications are off and you don't know why. */}
      <Section title="Permissions">
        <SettingRow hint="Delivery is granted in macOS System Settings → Notifications.">
          {bridgeAvailable ? (
            <span style={{ display: 'inline-flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
              <Button variant="outline" icon={Bell} onClick={sendTest}>Send test notification</Button>
              {window.electronNotifications?.openSystemSettings && (
                <Button
                  variant="ghost"
                  icon={ExternalLink}
                  onClick={() => window.electronNotifications?.openSystemSettings?.('notifications')}
                >
                  Open System Settings
                </Button>
              )}
            </span>
          ) : (
            <span style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-3)' }}>
              This surface can't show desktop notifications.
            </span>
          )}
        </SettingRow>
      </Section>

      <Section title="In-app tips">
        <SettingField id="showTips">
          <Toggle checked={config.showTips ?? true} onChange={(v) => { void onSave({ showTips: v }); }} />
        </SettingField>
        <SettingRow hint="Each tip shows once. This lets every tip show one more time.">
          <Button
            variant="outline"
            icon={RotateCcw}
            onClick={() => { void onSave({ discovery: resetTips(normalizeDiscovery(config.discovery)) }); }}
          >
            Show tips again
          </Button>
        </SettingRow>
      </Section>
    </>
  );
}
