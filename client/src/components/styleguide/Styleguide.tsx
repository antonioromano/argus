import {
  Settings, Maximize2, X, RefreshCw, GitCompare, Plus,
  GripVertical, Globe, Moon, Sun, Scan, AlertTriangle,
  Terminal, Layers,
} from 'lucide-react';
import { StatusDot, Badge, IconButton, Button, Tooltip, Skeleton } from '../primitives/index.js';
import { STATUS_COLORS, STATUS_LABELS } from '../../constants/status.js';
import type { SessionStatus } from '@argus/shared';

const STATUSES: SessionStatus[] = ['waiting', 'running', 'idle', 'exited'];

const COLOR_TOKENS = [
  { name: '--color-bg-base',     label: 'bg-base' },
  { name: '--color-bg-surface',  label: 'bg-surface' },
  { name: '--color-bg-elevated', label: 'bg-elevated' },
  { name: '--color-bg-header',   label: 'bg-header' },
  { name: '--color-bg-modal',    label: 'bg-modal' },
  { name: '--color-bg-input',    label: 'bg-input' },
  { name: '--color-bg-code',     label: 'bg-code' },
];

const BORDER_TOKENS = [
  { name: '--color-border-base',   label: 'border-base' },
  { name: '--color-border-subtle', label: 'border-subtle' },
];

const TEXT_TOKENS = [
  { name: '--color-text-primary',   label: 'text-primary' },
  { name: '--color-text-secondary', label: 'text-secondary' },
  { name: '--color-text-muted',     label: 'text-muted' },
];

const SEMANTIC_TOKENS = [
  { name: '--color-accent',  label: 'accent' },
  { name: '--color-success', label: 'success' },
  { name: '--color-error',   label: 'error' },
  { name: '--color-warning', label: 'warning' },
];

const STATUS_TOKENS = STATUSES.map((s) => ({
  name: `--color-status-${s}`,
  label: `status-${s}`,
}));

const SPACE_TOKENS = [1, 2, 3, 4, 5, 6, 8];
const RADIUS_TOKENS = [
  { name: '--radius-sm', label: 'sm (4px)' },
  { name: '--radius-md', label: 'md (6px)' },
  { name: '--radius-lg', label: 'lg (8px)' },
  { name: '--radius-xl', label: 'xl (12px)' },
  { name: '--radius-pill', label: 'pill (10px)' },
];

const TEXT_SCALE = [
  { name: '--text-xs',   label: 'xs (10px)',  size: '10px' },
  { name: '--text-sm',   label: 'sm (11px)',  size: '11px' },
  { name: '--text-base', label: 'base (13px)', size: '13px' },
  { name: '--text-md',   label: 'md (14px)',  size: '14px' },
  { name: '--text-lg',   label: 'lg (16px)',  size: '16px' },
  { name: '--text-xl',   label: 'xl (18px)',  size: '18px' },
];

const ICONS = [
  { icon: Settings, name: 'Settings' },
  { icon: Maximize2, name: 'Maximize2' },
  { icon: X, name: 'X' },
  { icon: RefreshCw, name: 'RefreshCw' },
  { icon: GitCompare, name: 'GitCompare' },
  { icon: Plus, name: 'Plus' },
  { icon: GripVertical, name: 'GripVertical' },
  { icon: Globe, name: 'Globe' },
  { icon: Moon, name: 'Moon' },
  { icon: Sun, name: 'Sun' },
  { icon: Scan, name: 'Scan' },
  { icon: AlertTriangle, name: 'AlertTriangle' },
  { icon: Terminal, name: 'Terminal' },
  { icon: Layers, name: 'Layers' },
];

export function Styleguide() {
  return (
    <div
      style={{
        padding: 'var(--space-6)',
        maxWidth: '900px',
        margin: '0 auto',
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-sans)',
        overflowY: 'auto',
        height: '100%',
      }}
    >
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ margin: '0 0 4px', fontSize: '24px', fontWeight: 700 }}>Design System</h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-md)' }}>
          Argus — visual reference for all tokens and components
        </p>
      </div>

      {/* ── COLORS ── */}
      <Section title="Colors">
        <SubSection title="Background">
          <SwatchRow tokens={COLOR_TOKENS} />
        </SubSection>
        <SubSection title="Border">
          <SwatchRow tokens={BORDER_TOKENS} border />
        </SubSection>
        <SubSection title="Text">
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {TEXT_TOKENS.map((t) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <span style={{ color: `var(${t.name})`, fontSize: 'var(--text-md)', fontWeight: 600 }}>Aa</span>
                <code style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{t.label}</code>
              </div>
            ))}
          </div>
        </SubSection>
        <SubSection title="Semantic">
          <SwatchRow tokens={SEMANTIC_TOKENS} />
        </SubSection>
        <SubSection title="Status">
          <SwatchRow tokens={STATUS_TOKENS} />
        </SubSection>
      </Section>

      {/* ── TYPOGRAPHY ── */}
      <Section title="Typography">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {TEXT_SCALE.map((t) => (
            <div key={t.name} style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
              <code style={{ width: '110px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                {t.label}
              </code>
              <span style={{ fontSize: t.size }}>The quick brown fox</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
            <code style={{ width: '110px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', flexShrink: 0 }}>mono</code>
            <span style={{ fontSize: 'var(--text-md)', fontFamily: 'var(--font-mono)' }}>/path/to/project</span>
          </div>
        </div>
      </Section>

      {/* ── SPACING ── */}
      <Section title="Spacing">
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {SPACE_TOKENS.map((n) => (
            <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
              <div
                style={{
                  width: `var(--space-${n})`,
                  height: `var(--space-${n})`,
                  background: 'var(--color-accent)',
                  borderRadius: 'var(--radius-sm)',
                }}
              />
              <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>--space-{n}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* ── BORDER RADIUS ── */}
      <Section title="Border Radius">
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {RADIUS_TOKENS.map((r) => (
            <div key={r.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: 'var(--color-accent-subtle)',
                  border: '1px solid var(--color-accent)',
                  borderRadius: `var(${r.name})`,
                }}
              />
              <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{r.label}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* ── ICONS ── */}
      <Section title="Icons (lucide-react)">
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {ICONS.map(({ icon: Icon, name }) => (
            <Tooltip key={name} content={name} position="top">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border-base)',
                  cursor: 'default',
                  minWidth: 56,
                }}
              >
                <Icon size={20} color="var(--color-text-secondary)" strokeWidth={1.75} />
                <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{name}</code>
              </div>
            </Tooltip>
          ))}
        </div>
      </Section>

      {/* ── BUTTONS ── */}
      <Section title="Buttons">
        <SubSection title="Variants">
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </div>
        </SubSection>
        <SubSection title="Sizes">
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" size="md">Medium</Button>
            <Button variant="primary" size="sm">Small</Button>
          </div>
        </SubSection>
        <SubSection title="States">
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
        </SubSection>
      </Section>

      {/* ── ICON BUTTONS ── */}
      <Section title="Icon Buttons">
        <SubSection title="Ghost (default)">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <IconButton icon={Settings} label="Settings" />
            <IconButton icon={Maximize2} label="Maximize" />
            <IconButton icon={X} label="Close" />
            <IconButton icon={RefreshCw} label="Refresh" />
          </div>
        </SubSection>
        <SubSection title="Outlined">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <IconButton icon={Settings} label="Settings" variant="outlined" />
            <IconButton icon={Globe} label="Remote Access" variant="outlined" />
            <IconButton icon={Moon} label="Toggle theme" variant="outlined" />
          </div>
        </SubSection>
        <SubSection title="Active state">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <IconButton icon={GitCompare} label="Diff active" active />
            <IconButton icon={Maximize2} label="Focused" active />
          </div>
        </SubSection>
        <SubSection title="Sizes">
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <IconButton icon={Settings} label="Settings (md)" size="md" />
            <IconButton icon={Settings} label="Settings (sm)" size="sm" />
          </div>
        </SubSection>
      </Section>

      {/* ── BADGES ── */}
      <Section title="Badges">
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge label="claude" />
          <Badge label="gemini" />
          <Badge label="codex" />
          <Badge label="custom" size="md" />
          <Badge label="error" color="var(--color-error)" />
        </div>
      </Section>

      {/* ── STATUS DOTS ── */}
      <Section title="Status Indicators">
        <div style={{ display: 'flex', gap: 'var(--space-6)', flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUSES.map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <StatusDot status={s} pulse={s === 'running'} />
              <span style={{ fontSize: 'var(--text-base)' }}>{STATUS_LABELS[s]}</span>
              <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{STATUS_COLORS[s]}</code>
            </div>
          ))}
        </div>
      </Section>

      {/* ── TOOLTIPS ── */}
      <Section title="Tooltips">
        <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
          Hover each button to see the tooltip. 600ms delay by default.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          {(['top', 'bottom', 'left', 'right'] as const).map((pos) => (
            <Tooltip key={pos} content={`Position: ${pos}`} position={pos}>
              <Button variant="secondary" size="sm">{pos}</Button>
            </Tooltip>
          ))}
          <Tooltip content="No delay tooltip" delay={0}>
            <Button variant="secondary" size="sm">instant</Button>
          </Tooltip>
        </div>
      </Section>

      {/* ── SKELETON ── */}
      <Section title="Skeleton Loading">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxWidth: '360px' }}>
          <Skeleton height="16px" width="60%" />
          <Skeleton height="16px" />
          <Skeleton height="16px" width="80%" />
          <Skeleton height="56px" borderRadius="var(--radius-lg)" />
        </div>
      </Section>

      <div style={{ height: 'var(--space-8)' }} />
    </div>
  );
}

/* ── Section layout components ── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--space-8)' }}>
      <h2
        style={{
          margin: '0 0 var(--space-4)',
          fontSize: 'var(--text-lg)',
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          paddingBottom: 'var(--space-2)',
          borderBottom: '1px solid var(--color-border-base)',
        }}
      >
        {title}
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {children}
      </div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function SwatchRow({ tokens, border }: { tokens: { name: string; label: string }[]; border?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
      {tokens.map((t) => (
        <div key={t.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div
            style={{
              width: 56,
              height: 40,
              borderRadius: 'var(--radius-md)',
              background: border ? 'var(--color-bg-surface)' : `var(${t.name})`,
              border: border ? `2px solid var(${t.name})` : '1px solid var(--color-border-base)',
            }}
          />
          <code style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{t.label}</code>
        </div>
      ))}
    </div>
  );
}
