import { describe, it, expect, vi } from 'vitest';
import { retainModel, releaseModel, modelRefCount } from './monacoModelRefs.js';

const now = (fn: () => void) => fn();

describe('monacoModelRefs', () => {
  it('keeps a model shared by two editors alive until the last one releases it', () => {
    const dispose = vi.fn();
    retainModel('/r/shared.ts'); // left group
    retainModel('/r/shared.ts'); // right group, same file
    releaseModel('/r/shared.ts', dispose, now); // close the tab on the left
    expect(dispose).not.toHaveBeenCalled();
    expect(modelRefCount('/r/shared.ts')).toBe(1);
    releaseModel('/r/shared.ts', dispose, now);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(modelRefCount('/r/shared.ts')).toBe(0);
  });

  it('a re-retain before the deferred dispose runs keeps the model (remount)', () => {
    const dispose = vi.fn();
    let pending: (() => void) | null = null;
    retainModel('/r/a.ts');
    releaseModel('/r/a.ts', dispose, (fn) => { pending = fn; });
    retainModel('/r/a.ts');
    pending!();
    expect(dispose).not.toHaveBeenCalled();
    releaseModel('/r/a.ts', dispose, now);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('paths are counted independently', () => {
    const dA = vi.fn();
    const dB = vi.fn();
    retainModel('/r/x.ts');
    retainModel('/r/y.ts');
    releaseModel('/r/x.ts', dA, now);
    expect(dA).toHaveBeenCalledTimes(1);
    expect(dB).not.toHaveBeenCalled();
    releaseModel('/r/y.ts', dB, now);
    expect(dB).toHaveBeenCalledTimes(1);
  });
});
