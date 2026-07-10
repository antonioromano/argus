import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, api, setToken } from './api.js';

describe('ApiError', () => {
  it('carries status and message', () => {
    const err = new ApiError(404, 'Not found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.name).toBe('ApiError');
  });

  it('is instanceof Error', () => {
    expect(new ApiError(500, 'oops')).toBeInstanceOf(Error);
  });

  it('is instanceof ApiError', () => {
    expect(new ApiError(422, 'bad')).toBeInstanceOf(ApiError);
  });
});

/** Build a minimal Response-like stub sufficient for authFetch/requireOk. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response;
}

/**
 * Simulates ngrok's free-tier behaviour: a request that omits the
 * `ngrok-skip-browser-warning` header gets the HTML interstitial page (whose
 * `.json()` rejects); a request that sends the header gets the real JSON body.
 */
function ngrokAwareResponse(init: RequestInit | undefined, jsonBody: unknown): Response {
  const headers = new Headers(init?.headers);
  const bypass = headers.get('ngrok-skip-browser-warning');
  if (!bypass) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      // Interstitial is HTML — parsing it as JSON throws, exactly the failure
      // mode this header exists to prevent.
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    } as unknown as Response;
  }
  return jsonResponse(200, jsonBody);
}

/** Minimal Map-backed localStorage — jsdom in this project does not expose one. */
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => void store.set(k, String(v)),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe('tunnel-safe mobile-first calls', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getAuthStatus', () => {
    it('sends the ngrok-skip-browser-warning header so it never hits the interstitial', async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(ngrokAwareResponse(init, { required: true, authenticated: false }))
      );
      vi.stubGlobal('fetch', fetchMock);

      const status = await api.getAuthStatus();

      expect(status).toEqual({ required: true, authenticated: false });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('ngrok-skip-browser-warning')).toBe('true');
    });

    it('attaches the bearer token when one is stored', async () => {
      setToken('tok-123');
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(ngrokAwareResponse(init, { required: true, authenticated: true }))
      );
      vi.stubGlobal('fetch', fetchMock);

      await api.getAuthStatus();

      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-123');
    });

    it('parses a normal JSON response', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { required: false }))));
      await expect(api.getAuthStatus()).resolves.toEqual({ required: false });
    });

    it('throws ApiError on a non-OK status', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(500, { error: 'boom' }))));
      await expect(api.getAuthStatus()).rejects.toMatchObject({ name: 'ApiError', status: 500 });
      await expect(api.getAuthStatus()).rejects.toBeInstanceOf(ApiError);
    });
  });

  describe('getNgrokStatus', () => {
    it('sends the ngrok-skip-browser-warning header and parses JSON', async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(ngrokAwareResponse(init, { running: true, url: 'https://x.ngrok.app' }))
      );
      vi.stubGlobal('fetch', fetchMock);

      const status = await api.getNgrokStatus();

      expect(status).toEqual({ running: true, url: 'https://x.ngrok.app' });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('ngrok-skip-browser-warning')).toBe('true');
    });

    it('throws ApiError on a non-OK status', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(503, { error: 'down' }))));
      await expect(api.getNgrokStatus()).rejects.toMatchObject({ name: 'ApiError', status: 503 });
    });
  });

  describe('login', () => {
    it('sends the ngrok-skip-browser-warning header and returns the token', async () => {
      const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
        Promise.resolve(ngrokAwareResponse(init, { token: 'new-token' }))
      );
      vi.stubGlobal('fetch', fetchMock);

      const res = await api.login('hunter2');

      expect(res).toEqual({ token: 'new-token' });
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(new Headers(init.headers).get('ngrok-skip-browser-warning')).toBe('true');
    });

    it('surfaces a wrong password as ApiError("Incorrect password"), not a generic auth reset', async () => {
      // A prior (stale) token must NOT be wiped by a failed login attempt, and no
      // auth:unauthorized event should fire — that path is for session expiry.
      setToken('stale-token');
      const unauthorized = vi.fn();
      window.addEventListener('auth:unauthorized', unauthorized);
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(401, { error: 'Incorrect password' }))));

      try {
        await expect(api.login('wrong')).rejects.toMatchObject({
          name: 'ApiError',
          status: 401,
          message: 'Incorrect password',
        });
        expect(localStorage.getItem('orchestrator_auth_token')).toBe('stale-token');
        expect(unauthorized).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('auth:unauthorized', unauthorized);
      }
    });
  });
});
