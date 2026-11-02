import { createElement } from 'react';
import type { ReactNode, CSSProperties, HTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
import { Icon } from './Icon.js';
import { spaceSuffix, type SpaceToken, type TextSize, type TextTone } from './scale.js';

/* Layout primitives on the locked scales (plan 005).
 *
 * Every static value lives in a class (`.ds-*`, index.css "DS LAYOUT"), so a
 * primitive allocates no style object of its own: memoized tiles that render
 * them stay cheap, and the props are typed so an off-scale gap or size does not
 * compile. `style` and `className` pass through for the dynamic remainder, and
 * an inline `style` value wins over the class. No `.ds-*` class sets a :hover
 * rule — hover must never reflow a row. */

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Align = 'center' | 'start' | 'end' | 'baseline' | 'stretch';
type Justify = 'start' | 'between' | 'end' | 'center';

interface FlexProps extends HTMLAttributes<HTMLElement> {
  gap?: SpaceToken;
  align?: Align;
  justify?: Justify;
  /** flex: 1 + min-width: 0 — fill the parent's free space and allow truncation. */
  grow?: boolean;
  as?: 'div' | 'span' | 'label';
  htmlFor?: string;
  children?: ReactNode;
}

function flex(base: 'ds-row' | 'ds-stack', defaultAlign: Align, wrap: boolean | undefined, props: FlexProps) {
  const { gap, align = defaultAlign, justify, grow, as = 'div', className, children, ...rest } = props;
  return createElement(
    as,
    {
      ...rest,
      className: cx(
        base,
        `ds-align-${align}`,
        justify && `ds-justify-${justify}`,
        gap !== undefined && gap !== 0 && `ds-gap-${spaceSuffix(gap)}`,
        wrap && 'ds-wrap',
        grow && 'ds-grow',
        className,
      ),
    },
    children,
  );
}

export interface RowProps extends FlexProps {
  wrap?: boolean;
}

/** Horizontal flex container. Centred cross-axis by default. */
export function Row({ wrap, ...props }: RowProps) {
  return flex('ds-row', 'center', wrap, props);
}

export type StackProps = FlexProps;

/** Vertical flex container. Stretches children across by default. */
export function Stack(props: StackProps) {
  return flex('ds-stack', 'stretch', false, props);
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
  /** Type role. Omitted → inherits the parent's size. */
  size?: TextSize;
  /** Colour role. Omitted → inherits the parent's colour. */
  tone?: TextTone;
  mono?: boolean;
  weight?: 500 | 600;
  /** One line, clipped with an ellipsis. Pair with `title` for the full text. */
  truncate?: boolean;
  as?: 'span' | 'div' | 'p';
  children?: ReactNode;
}

/** Text on the type scale. */
export function Text({ size, tone, mono, weight, truncate, as = 'span', className, children, ...rest }: TextProps) {
  return createElement(
    as,
    {
      ...rest,
      className: cx(
        'ds-text',
        size && `ds-t-${size}`,
        tone && `ds-tone-${tone}`,
        mono && 'ds-mono',
        weight && `ds-w-${weight}`,
        truncate && 'ds-truncate',
        className,
      ),
    },
    children,
  );
}

/** Pushes its siblings apart inside a Row/Stack (flex: 1, min-width: 0). */
export function Spacer() {
  return <div className="ds-spacer" />;
}

export function HRule() {
  return <div style={{ height: 1, background: 'var(--line-2)' }} />;
}

export function VRule() {
  return <div style={{ width: 1, background: 'var(--line-2)', alignSelf: 'stretch' }} />;
}

interface SectionProps {
  title?: string;
  action?: ReactNode;
  /** When true, children are rendered directly without the card chrome (advanced layouts). */
  bare?: boolean;
  children?: ReactNode;
}

/**
 * Grouped-card section (macOS System Settings pattern): a small, quiet title sits
 * above a single rounded card that contains the rows. Replaces the old per-section
 * eyebrow-header + bottom-hairline treatment that read as noise when stacked.
 */
export function Section({ title, action, bare, children }: SectionProps) {
  return (
    <section className="settings-group">
      {(title || action) && (
        <div className="settings-group-head">
          {title && <span className="settings-group-title">{title}</span>}
          {action}
        </div>
      )}
      {bare ? children : <div className="settings-card">{children}</div>}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="ds-kbd">{children}</span>;
}

interface ChipProps {
  children?: ReactNode;
  icon?: LucideIcon;
  dot?: string;
  onRemove?: () => void;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function Chip({ children, icon: Glyph, dot, onRemove, active, onClick, style }: ChipProps) {
  return (
    <span
      onClick={onClick}
      className={cx('ds-chip', active && 'ds-chip--active', onClick && 'ds-chip--clickable')}
      style={style}
    >
      {dot && <span className="ds-chip-dot" style={{ background: dot }} />}
      {Glyph && <Icon icon={Glyph} size="xs" />}
      {children}
      {onRemove && (
        <span
          className="ds-chip-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Icon icon={X} size="xs" />
        </span>
      )}
    </span>
  );
}
