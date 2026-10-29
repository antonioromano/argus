import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SESSION_COLOR_KEYS } from '@argus/shared';
import { SessionIdentity } from './SessionIdentity.js';
import { identityEdgeProps, resolveIdentityColor, isSingleEmoji } from '../../utils/sessionIdentity.js';
import { GROUP_COLORS } from '../../constants/groupColors.js';
import { displayLabel } from '../../utils/sessionLabel.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('SessionIdentity', () => {
  it('renders nothing without an emoji, so an unset identity leaves the DOM as it was', () => {
    act(() => root.render(<SessionIdentity session={{}} />));
    expect(container.innerHTML).toBe('');
  });

  it('renders the emoji in a fixed slot, hidden from assistive tech (the name is the label)', () => {
    act(() => root.render(<SessionIdentity session={{ emoji: '👩‍💻' }} />));
    const slot = container.querySelector('.argus-identity-emoji')!;
    expect(slot.textContent).toBe('👩‍💻');
    expect(slot.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('identityEdgeProps', () => {
  it('is empty without a colour, or with a key the palette does not know', () => {
    expect(identityEdgeProps(undefined, true)).toEqual({});
    expect(identityEdgeProps('mauve', true)).toEqual({});
  });

  it('resolves the key per theme to the group palette, as an edge (never a border)', () => {
    const teal = GROUP_COLORS.find((c) => c.key === 'teal')!;
    const dark = identityEdgeProps('teal', true);
    expect(dark['data-identity-edge']).toBe('teal');
    expect(dark.style).toEqual({ '--identity-edge': teal.dark });
    expect(identityEdgeProps('teal', false).style).toEqual({ '--identity-edge': teal.light });
    expect(JSON.stringify(dark.style)).not.toMatch(/border/);
    expect(resolveIdentityColor('teal', false)).toBe(teal.light);
  });

  it('the palette the client renders is exactly the set the server accepts', () => {
    expect(GROUP_COLORS.map((c) => c.key).sort()).toEqual(Object.keys(SESSION_COLOR_KEYS).sort());
  });
});

describe('displayLabel', () => {
  it('puts the emoji before the label and falls back to the folder name', () => {
    expect(displayLabel({ name: 'api', folderPath: '/r/api', emoji: '🦊' })).toBe('🦊 api');
    expect(displayLabel({ name: '', folderPath: '/r/web' })).toBe('web');
  });
});

describe('isSingleEmoji', () => {
  it('matches the server rules', () => {
    for (const ok of ['🦊', '👩‍💻', '🇮🇹', '❄️']) expect(isSingleEmoji(ok), ok).toBe(true);
    for (const bad of ['ab', '🦊🦊', 'x', '', '1']) expect(isSingleEmoji(bad), bad).toBe(false);
  });
});
