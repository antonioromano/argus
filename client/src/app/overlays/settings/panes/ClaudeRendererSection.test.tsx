import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type AppConfig } from '@argus/shared';
import { ClaudeRendererSection } from './ClaudeRendererSection.js';

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean | undefined; }

let container: HTMLDivElement; let root: Root;
let onSave: ReturnType<typeof vi.fn<(data: Partial<AppConfig>) => Promise<AppConfig>>>;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onSave = vi.fn<(data: Partial<AppConfig>) => Promise<AppConfig>>().mockResolvedValue(DEFAULT_CONFIG);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (config: AppConfig) => act(() => { root.render(<ClaudeRendererSection config={config} onSave={onSave} />); });
const radio = (name: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find((b) => b.textContent?.includes(name))!;

describe('ClaudeRendererSection', () => {
  it('shows fullscreen selected by default', () => {
    render({ ...DEFAULT_CONFIG, claudeRenderer: undefined });
    expect(radio('Fullscreen').getAttribute('aria-checked')).toBe('true');
    expect(radio('Classic').getAttribute('aria-checked')).toBe('false');
  });

  it('saves the picked renderer', () => {
    render(DEFAULT_CONFIG);
    act(() => { radio('Classic').click(); });
    expect(onSave).toHaveBeenCalledWith({ claudeRenderer: 'classic' });
  });

  it('warns about duplicated messages only when classic is chosen', () => {
    render(DEFAULT_CONFIG);
    expect(container.textContent).not.toMatch(/duplicat/i);
    render({ ...DEFAULT_CONFIG, claudeRenderer: 'classic' });
    expect(container.textContent).toMatch(/duplicat/i);
  });
});
