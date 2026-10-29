import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Row, Stack, Text, Spacer, Kbd, Chip } from './Layout.js';
import { space, SPACE_TOKENS, type SpaceToken } from './scale.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => { root = createRoot(container); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined;
});

function render(node: ReactNode): HTMLElement {
  act(() => root.render(node));
  return container.firstElementChild as HTMLElement;
}

describe('space()', () => {
  it.each<[SpaceToken, string]>([
    [0, '0'],
    ['px', 'var(--s-px)'],
    [0.5, 'var(--s-0-5)'],
    [1, 'var(--s-1)'],
    [1.5, 'var(--s-1-5)'],
    [2, 'var(--s-2)'],
    [7, 'var(--s-7)'],
  ])('%s → %s', (t, css) => {
    expect(space(t)).toBe(css);
  });

  it('lists every token once', () => {
    expect(new Set(SPACE_TOKENS).size).toBe(SPACE_TOKENS.length);
  });
});

describe('Row', () => {
  it('renders a flex row, centred by default, with the gap as a class', () => {
    const el = render(<Row gap={1.5}>a</Row>);
    expect(el.tagName).toBe('DIV');
    expect(el.classList.contains('ds-row')).toBe(true);
    expect(el.classList.contains('ds-align-center')).toBe(true);
    expect(el.classList.contains('ds-gap-1-5')).toBe(true);
  });

  it('sets no inline style for the static part', () => {
    const el = render(<Row gap={2} align="baseline" justify="between" wrap grow>a</Row>);
    expect(el.getAttribute('style')).toBeNull();
    expect([...el.classList]).toEqual(
      expect.arrayContaining(['ds-row', 'ds-gap-2', 'ds-align-baseline', 'ds-justify-between', 'ds-wrap', 'ds-grow']),
    );
  });

  it('forwards className, style, handlers and HTML attributes', () => {
    const onClick = vi.fn();
    const el = render(
      <Row className="extra" style={{ color: 'var(--accent)' }} onClick={onClick} title="t" data-testid="r" role="group">
        a
      </Row>,
    );
    expect(el.classList.contains('extra')).toBe(true);
    expect(el.style.color).toBe('var(--accent)');
    expect(el.getAttribute('title')).toBe('t');
    expect(el.getAttribute('data-testid')).toBe('r');
    expect(el.getAttribute('role')).toBe('group');
    act(() => el.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('lets a dynamic style value win over the class', () => {
    const el = render(<Row gap={2} style={{ gap: 'var(--s-4)' }}>a</Row>);
    expect(el.style.gap).toBe('var(--s-4)');
  });

  it('renders as a span or label', () => {
    expect(render(<Row as="span">a</Row>).tagName).toBe('SPAN');
    expect(render(<Row as="label">a</Row>).tagName).toBe('LABEL');
  });

  it('omits the gap class when no gap is given', () => {
    const el = render(<Row>a</Row>);
    expect([...el.classList].some((c) => c.startsWith('ds-gap-'))).toBe(false);
  });
});

describe('Stack', () => {
  it('renders a flex column that stretches by default', () => {
    const el = render(<Stack gap={4}>a</Stack>);
    expect(el.classList.contains('ds-stack')).toBe(true);
    expect(el.classList.contains('ds-align-stretch')).toBe(true);
    expect(el.classList.contains('ds-gap-4')).toBe(true);
  });
});

describe('Text', () => {
  it('maps size and tone to role classes', () => {
    const el = render(<Text size="caption" tone="muted">hi</Text>);
    expect(el.tagName).toBe('SPAN');
    expect([...el.classList]).toEqual(expect.arrayContaining(['ds-text', 'ds-t-caption', 'ds-tone-muted']));
  });

  it('inherits colour and size when no tone/size is given', () => {
    const el = render(<Text>hi</Text>);
    expect([...el.classList]).toEqual(['ds-text']);
  });

  it('sets the ellipsis class for truncate and passes title through', () => {
    const el = render(<Text truncate title="full name">full name</Text>);
    expect(el.classList.contains('ds-truncate')).toBe(true);
    expect(el.getAttribute('title')).toBe('full name');
  });

  it('supports mono, weight and block elements', () => {
    const el = render(<Text as="p" mono weight={600}>x</Text>);
    expect(el.tagName).toBe('P');
    expect([...el.classList]).toEqual(expect.arrayContaining(['ds-mono', 'ds-w-600']));
  });
});

describe('Spacer', () => {
  it('is a growing, shrinkable div', () => {
    const el = render(<Spacer />);
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('ds-spacer');
  });
});

describe('Kbd and Chip on tokens', () => {
  it('Kbd renders through a class, no inline style', () => {
    const el = render(<Kbd>⌘K</Kbd>);
    expect(el.className).toBe('ds-kbd');
    expect(el.getAttribute('style')).toBeNull();
  });

  it('Chip marks active and clickable state with classes', () => {
    const onClick = vi.fn();
    const el = render(<Chip active onClick={onClick}>x</Chip>);
    expect([...el.classList]).toEqual(expect.arrayContaining(['ds-chip', 'ds-chip--active', 'ds-chip--clickable']));
    act(() => el.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('Chip remove does not trigger the chip click', () => {
    const onClick = vi.fn();
    const onRemove = vi.fn();
    const el = render(<Chip onClick={onClick} onRemove={onRemove}>x</Chip>);
    act(() => (el.querySelector('.ds-chip-remove') as HTMLElement).click());
    expect(onRemove).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});

// Compile-time checks — `tsc -b` fails if an off-scale value type-checks.
function TypeChecks() {
  return (
    <>
      {/* @ts-expect-error 2.5 is off the spacing scale (steps, not px) */}
      <Row gap={2.5}>a</Row>
      {/* @ts-expect-error 9 is off the spacing scale (steps, not px) */}
      <Stack gap={9}>a</Stack>
      {/* @ts-expect-error 'base' is not a type role */}
      <Text size="base">a</Text>
      {/* @ts-expect-error tone must be a named tone */}
      <Text tone="fg-2">a</Text>
    </>
  );
}

it('off-scale props are compile errors (see TypeChecks)', () => {
  expect(TypeChecks).toBeTypeOf('function');
});
