import { useEffect, useMemo, useState } from 'react';
import type { MenuCommandWire } from '@argus/shared';
import { AlertTriangle, Search } from 'lucide-react';
import {
  Button, EmptyState, Icon, Kbd, Row, Section, SettingRow, Sheet, Text, TextInput,
} from '../../components/primitives/index.js';
import { describeMenu } from '../../commands/menuBridge.js';
import { buildCheatsheet, filterCheatsheet } from '../../keyboard/cheatsheet.js';
import type { ShortcutActionId } from '../../keyboard/registry.js';
import type { ResolvedShortcuts } from '../../keyboard/useShortcuts.js';

interface ShortcutsSheetProps {
  resolved: ResolvedShortcuts;
  conflicts: ReadonlySet<ShortcutActionId>;
  overrides?: Record<string, string>;
  onClose: () => void;
  /** Open Settings on the given pane (always 'keyboard' here). */
  onCustomize: (pane: 'keyboard') => void;
}

/**
 * Every keyboard shortcut as the user has it bound (⌘/, Help → Keyboard
 * Shortcuts; plan 002). Generated from the registry and the live app menu, so
 * a rebind in Settings → Keyboard shows up the next time it opens.
 */
export function ShortcutsSheet({ resolved, conflicts, overrides, onClose, onCustomize }: ShortcutsSheetProps) {
  const [query, setQuery] = useState('');
  // Asked once per window (describeMenu caches); outside Electron it is [] and
  // the sheet shows the registry and the system roles only.
  const [menu, setMenu] = useState<MenuCommandWire[]>([]);
  useEffect(() => {
    let live = true;
    void describeMenu().then((items) => { if (live) setMenu(items); });
    return () => { live = false; };
  }, []);

  const groups = useMemo(
    () => buildCheatsheet(resolved, conflicts, overrides, menu),
    [resolved, conflicts, overrides, menu],
  );
  const shown = useMemo(() => filterCheatsheet(groups, query), [groups, query]);

  return (
    <Sheet
      title="Keyboard Shortcuts"
      width={640}
      onClose={onClose}
      footer={<Button onClick={() => onCustomize('keyboard')}>Customize in Settings…</Button>}
    >
      <TextInput
        value={query}
        onChange={setQuery}
        placeholder="Search by name or keys, e.g. “palette” or “⌘⇧F”"
        icon={Search}
        type="search"
        autoFocus
        spellCheck={false}
      />
      {shown.length === 0 ? (
        <EmptyState icon={Search} title={`No shortcut matches “${query.trim()}”`} hint="Try a name, a menu, or keys like cmd shift f." />
      ) : (
        shown.map((g) => (
          <Section key={g.title} title={g.title}>
            {g.rows.map((r) => (
              <SettingRow key={r.id} label={r.label} hint={r.note}>
                <Row gap={2}>
                  {r.overridden && <Text size="caption" tone="faint" title="You changed this binding in Settings">edited</Text>}
                  {r.conflict && (
                    <Text tone="danger" title="This combo is bound to more than one action" style={{ display: 'flex' }}>
                      <Icon icon={AlertTriangle} size={14} />
                    </Text>
                  )}
                  <Kbd>{r.keys}</Kbd>
                </Row>
              </SettingRow>
            ))}
          </Section>
        ))
      )}
    </Sheet>
  );
}
