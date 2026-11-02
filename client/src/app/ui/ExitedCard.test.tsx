import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExitedCard } from './ExitedCard.js';

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

const buttons = () => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('ExitedCard', () => {
  it('offers only Restart when there is nothing to resume', () => {
    act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} />));
    expect(buttons()).toEqual(['Restart']);
  });

  it('offers Resume conversation next to Restart, and each does its own thing', () => {
    const onRestart = vi.fn();
    const onResume = vi.fn();
    act(() => root.render(<ExitedCard folderPath="/repo" onRestart={onRestart} onResume={onResume} />));
    expect(buttons()).toEqual(['Resume conversation', 'Restart']);
    const [resume, restart] = [...container.querySelectorAll('button')];
    act(() => resume!.click());
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
    act(() => restart!.click());
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  describe('missing agent command (exit 127)', () => {
    const claude = { agentCommand: 'claude', installCommand: 'curl -fsSL https://claude.ai/install.sh | bash' };
    const text = () => container.textContent ?? '';

    it('shows the not-found variant when 127 comes within 5s of spawn', () => {
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} exitCode={127} exitedAfterMs={900} {...claude} />));
      expect(text()).toContain('Couldn’t find claude');
      expect(text()).toMatch(/exit code 127/i);
      expect(buttons()).toEqual(['Copy install command', 'Restart']);
    });

    it('copies the install command and confirms it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} exitCode={127} exitedAfterMs={900} {...claude} />));
      const copy = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Copy install command'))!;
      await act(async () => { copy.click(); });
      expect(writeText).toHaveBeenCalledWith(claude.installCommand);
      expect(buttons()).toContain('Copied');
    });

    it('Restart still restarts in the not-found variant', () => {
      const onRestart = vi.fn();
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={onRestart} exitCode={127} exitedAfterMs={900} {...claude} />));
      const restart = [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Restart')!;
      act(() => restart.click());
      expect(onRestart).toHaveBeenCalledTimes(1);
    });

    it('without a known install command, says to check PATH and offers only Restart', () => {
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} exitCode={127} exitedAfterMs={900} agentCommand="my-agent" />));
      expect(text()).toContain('Couldn’t find my-agent');
      expect(text()).toContain('Check that my-agent is installed and on your PATH');
      expect(buttons()).toEqual(['Restart']);
    });

    it('keeps the normal card for exit 127 after more than 5s (the agent itself exited 127)', () => {
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} exitCode={127} exitedAfterMs={6000} {...claude} />));
      expect(text()).not.toContain('Couldn’t find');
      expect(text()).toContain('Agent exited');
      expect(buttons()).toEqual(['Restart']);
    });

    it('keeps the normal card for a normal quick exit', () => {
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} exitCode={0} exitedAfterMs={900} {...claude} />));
      expect(text()).not.toContain('Couldn’t find');
      expect(text()).toContain('Agent exited');
    });

    it('keeps the normal card when the exit code is unknown', () => {
      act(() => root.render(<ExitedCard folderPath="/repo" onRestart={() => {}} {...claude} />));
      expect(text()).toContain('Agent exited');
    });
  });
});
