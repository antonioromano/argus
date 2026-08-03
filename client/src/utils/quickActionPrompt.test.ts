import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@argus/shared';
import { shouldPromptQuickAction } from './quickActionPrompt.js';

const cfg = (quickActionPromptedAt?: string) =>
  ({ quickActionPromptedAt }) as Pick<AppConfig, 'quickActionPromptedAt'>;

describe('shouldPromptQuickAction', () => {
  it('prompts a fresh install (empty marker) once the version is known', () => {
    expect(shouldPromptQuickAction(cfg(''), '0.22.0')).toBe(true);
  });

  it('prompts when the marker is absent entirely (config written before this release)', () => {
    expect(shouldPromptQuickAction(cfg(undefined), '0.22.0')).toBe(true);
  });

  it('stays quiet once a version has been recorded', () => {
    expect(shouldPromptQuickAction(cfg('0.22.0'), '0.22.0')).toBe(false);
  });

  it('stays quiet on later versions too — the marker is not compared for equality', () => {
    expect(shouldPromptQuickAction(cfg('0.22.0'), '0.23.1')).toBe(false);
  });

  it('holds back while the running version is still unknown', () => {
    // Guards against writing a marker on boot and suppressing the prompt forever.
    expect(shouldPromptQuickAction(cfg(''), undefined)).toBe(false);
    expect(shouldPromptQuickAction(cfg(''), null)).toBe(false);
    expect(shouldPromptQuickAction(cfg(''), '')).toBe(false);
  });

  it('holds back until config has loaded', () => {
    expect(shouldPromptQuickAction(null, '0.22.0')).toBe(false);
    expect(shouldPromptQuickAction(undefined, '0.22.0')).toBe(false);
  });
});
