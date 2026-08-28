import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSocketUrl, fetchChatEndpoint, OTA_TIMEOUT_MS } from './ota-client';
import { DEFAULT_CONFIG } from '../config/device-config';

const config = { ...DEFAULT_CONFIG, macAddress: 'aa:bb:cc:dd:ee:ff' };

describe('buildSocketUrl', () => {
  it('sends the device id under both spellings the gateway accepts', () => {
    const url = new URL(buildSocketUrl('ws://localhost:8000/xiaozhi/v1/', config, 'tok'));

    expect(url.searchParams.get('device-id')).toBe('aa:bb:cc:dd:ee:ff');
    expect(url.searchParams.get('device_id')).toBe('aa:bb:cc:dd:ee:ff');
    expect(url.searchParams.get('token')).toBe('tok');
  });

  it('appends to a URL that already has a query string', () => {
    const url = buildSocketUrl('ws://host/path?foo=1', config, 'tok');

    expect(url).toContain('?foo=1&');
    expect(new URL(url).searchParams.get('foo')).toBe('1');
  });

  it('omits the token when OTA did not issue one', () => {
    const url = new URL(buildSocketUrl('ws://localhost:8000/', config, ''));

    // An empty `token=` reads as a real, empty credential to some gateways and
    // gets rejected — better to leave the parameter out entirely.
    expect(url.searchParams.has('token')).toBe(false);
  });
});

/**
 * The regression this guards.
 *
 * `WsClient.connect()` awaits this before it opens any socket, so a URL that
 * hangs instead of refusing used to wedge the simulator on "Bống đang dậy…"
 * for good: no error, no fallback, no reconnect, nothing on the glass. A stale
 * OTA address in `localStorage` — say, the dead one you point at while testing
 * against the fake server — was enough to do it.
 */
describe('fetchChatEndpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives up on an endpoint that never answers', async () => {
    // A real hang: resolves and rejects for nobody. Only the abort can end it,
    // which is the whole point — the previous version of this waited forever.
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    await expect(fetchChatEndpoint(DEFAULT_CONFIG, undefined, 10)).rejects.toThrow();
  });

  it('still gives the endpoint a real chance by default', () => {
    // Long enough for a cold start, short enough that nobody concludes the toy
    // is broken. Pinned so shortening it is a decision rather than a slip.
    expect(OTA_TIMEOUT_MS).toBe(8_000);
  });

  it('honours a caller abort as well as its own clock', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

    const caller = new AbortController();
    const attempt = fetchChatEndpoint(DEFAULT_CONFIG, caller.signal);
    caller.abort();
    await expect(attempt).rejects.toThrow();
  });

  it('returns the socket address the endpoint hands back', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response(JSON.stringify({ websocket: { url: 'wss://host/v1/', token: 'tok' } }), {
          status: 200,
        }),
      ),
    );

    await expect(fetchChatEndpoint(DEFAULT_CONFIG)).resolves.toEqual({
      wsUrl: 'wss://host/v1/',
      token: 'tok',
    });
  });

  it('rejects a 200 that carries no socket address', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(new Response(JSON.stringify({ firmware: {} }), { status: 200 })),
    );

    await expect(fetchChatEndpoint(DEFAULT_CONFIG)).rejects.toThrow(/no websocket.url/);
  });
});
