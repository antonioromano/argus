import { useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Sheet, Row, Stack, Text } from '../../../components/primitives/index.js';
import { SECTION_ORDER, type ImportItem, type ImportPlan, type ImportSection } from '../../../settings-backup/diffImport.js';

const SECTION_TITLE: Record<ImportSection, string> = {
  preferences: 'Preferences',
  agents: 'Custom agents',
  flags: 'Agent flags',
  templates: 'Templates',
  launchers: 'Launchers',
};

interface ImportPreviewSheetProps {
  plan: ImportPlan;
  /** Why a section cannot be applied yet (templates while their beta is off). */
  sectionNotes?: Partial<Record<ImportSection, string>>;
  applying: boolean;
  onApply: (selected: Set<string>) => void;
  onCancel: () => void;
}

/**
 * What an import would change, before anything is written. Every item has a
 * checkbox; items that change what runs (custom agents, flags, auto-approval,
 * folder roots, the process backend) start unchecked with a warning, and an
 * identical template or launcher is shown but cannot be picked.
 */
export function ImportPreviewSheet({ plan, sectionNotes = {}, applying, onApply, onCancel }: ImportPreviewSheetProps) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(plan.items.filter((i) => i.defaultSelected).map((i) => i.key)),
  );
  const selectable = useMemo(() => plan.items.filter((i) => i.status !== 'identical'), [plan]);
  const sections = SECTION_ORDER.map((s) => ({ id: s, items: plan.items.filter((i) => i.section === s) }))
    .filter((s) => s.items.length > 0);
  const { unrecognized, problems } = plan.parsed;
  const count = selectable.filter((i) => selected.has(i.key)).length;

  const toggle = (keys: string[], on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    for (const k of keys) {
      if (on) next.add(k);
      else next.delete(k);
    }
    return next;
  });

  return (
    <Sheet
      eyebrow="IMPORT SETTINGS"
      title="Review what changes"
      subtitle={`${count} of ${selectable.length} selected`}
      width={640}
      onClose={applying ? undefined : onCancel}
      footer={
        <Row gap={3} style={{ width: '100%' }}>
          <Text size="small" tone="faint" style={{ flex: 1 }}>
            Your current settings are backed up first.
          </Text>
          <Button variant="ghost" onClick={onCancel} disabled={applying}>Cancel</Button>
          <Button variant="primary" onClick={() => onApply(selected)} disabled={count === 0} loading={applying}>
            Import {count} item{count === 1 ? '' : 's'}
          </Button>
        </Row>
      }
    >
      <Stack gap={5}>
        {sections.length === 0 && (
          <Text as="div" size="body" tone="muted">
            Everything in this file already matches your settings.
          </Text>
        )}
        {sections.map(({ id, items }) => {
          const pickable = items.filter((i) => i.status !== 'identical').map((i) => i.key);
          const allOn = pickable.length > 0 && pickable.every((k) => selected.has(k));
          const someOn = pickable.some((k) => selected.has(k));
          return (
            <section key={id} data-import-section={id}>
              <Row gap={2} style={{ marginBottom: 'var(--s-2)' }}>
                <Checkbox
                  checked={allOn}
                  indeterminate={someOn && !allOn}
                  disabled={pickable.length === 0}
                  onChange={(on) => toggle(pickable, on)}
                />
                <span className="settings-group-title" style={{ flex: 1 }}>{SECTION_TITLE[id]}</span>
              </Row>
              {sectionNotes[id] && (
                <Text as="div" size="small" tone="warn" style={{ marginBottom: 'var(--s-2)' }}>
                  {sectionNotes[id]}
                </Text>
              )}
              <div className="settings-card">
                {items.map((i) => (
                  <ImportRow key={i.key} item={i} checked={selected.has(i.key)} onToggle={(on) => toggle([i.key], on)} />
                ))}
              </div>
            </section>
          );
        })}
        {(unrecognized.length > 0 || problems.length > 0) && (
          <section data-import-section="ignored">
            <div className="settings-group-title" style={{ marginBottom: 'var(--s-2)' }}>Not imported</div>
            <ul style={{ margin: 0, paddingLeft: 'var(--s-5)', fontSize: 'var(--t-xs)', color: 'var(--fg-2)' }}>
              {problems.map((p) => <li key={p}>{p}</li>)}
              {unrecognized.length > 0 && <li>Not recognized: {unrecognized.join(', ')}</li>}
            </ul>
          </section>
        )}
      </Stack>
    </Sheet>
  );
}

function ImportRow({ item, checked, onToggle }: { item: ImportItem; checked: boolean; onToggle: (on: boolean) => void }) {
  const identical = item.status === 'identical';
  const valueStyle = item.mono ? { fontFamily: 'var(--font-mono)' } : undefined;
  return (
    <Row
      align="start"
      gap={3}
      data-import-item={item.key}
      style={{
        padding: 'var(--s-2-5) var(--s-3)',
        opacity: identical ? 0.6 : 1,
      }}
    >
      <span style={{ paddingTop: 'var(--s-0-5)' }}>
        <Checkbox checked={checked && !identical} disabled={identical} onChange={onToggle} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Row gap={2} style={{ fontSize: 'var(--t-sm)', color: 'var(--fg-0)' }}>
          <span>{item.label}</span>
          {item.status === 'new' && <Badge label="New" />}
          {item.sensitive && <Badge label="Review" color="var(--warn)" />}
        </Row>
        <Text as="div" size="small" tone="muted" style={{ overflowWrap: 'anywhere' }}>
          {item.before !== undefined && <><span style={valueStyle}>{item.before}</span>{' → '}</>}
          <span style={valueStyle}>{item.after}</span>
        </Text>
        {item.note && <Text as="div" size="small" tone="faint">{item.note}</Text>}
      </div>
    </Row>
  );
}
