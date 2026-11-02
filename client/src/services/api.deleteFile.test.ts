import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, api } from './api.js';

// DELETE /fs/file stages into the trash; an item on another volume (EXDEV) is
// answered 409 needsPermanent. deleteFile hands that back as a value so the
// caller can ask before deleting for good; every other failure still throws.

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('api.deleteFile', () => {
  it('returns the 409 needsPermanent body instead of throwing', async () => {
    const body = { success: false, error: 'This item is on another volume, so deleting it cannot be undone', needsPermanent: true };
    vi.stubGlobal('fetch', vi.fn(async () => json(409, body)));
    await expect(api.deleteFile('s1', '/repo/big')).resolves.toEqual(body);
  });

  it('a 409 without needsPermanent is still an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { success: false, error: 'Conflict' })));
    const err = await api.deleteFile('s1', '/repo/a.ts').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Conflict' });
  });

  it('sends permanent: true only when asked', async () => {
    const fetchMock = vi.fn(async () => json(200, { success: true }));
    vi.stubGlobal('fetch', fetchMock);
    await api.deleteFile('s1', '/repo/a.ts');
    await api.deleteFile('s1', '/repo/big', true);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies).toEqual([{ sessionId: 's1', path: '/repo/a.ts' }, { sessionId: 's1', path: '/repo/big', permanent: true }]);
  });
});
