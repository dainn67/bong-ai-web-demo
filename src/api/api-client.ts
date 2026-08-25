/**
 * The authenticated half of the backend, behind the dev proxy.
 *
 * Real firmware never speaks this API — it authenticates with a MAC address and
 * a device token, and the lesson APIs do not accept those. Everything here
 * exists so the simulator can stand in for a signed-in *parent*, which is what
 * the lesson content actually requires. See `docs/plan-app-modes-on-device.md`.
 */

/** Where the proxy puts `bong-api.bcserver.xyz`. See `/api` in vite.config. */
const API_BASE = '/api/v1';

const ACCESS_KEY = 'bong.sim.access';
const REFRESH_KEY = 'bong.sim.refresh';

/**
 * Tokens in localStorage.
 *
 * The app puts these in the platform keychain and is right to. This is a test
 * harness on a developer's machine talking to a dev backend, and pretending
 * otherwise would add ceremony without adding safety. Worth being explicit
 * about rather than quietly doing it.
 */
export const tokenStore = {
  get access(): string | null {
    return read(ACCESS_KEY);
  },
  get refresh(): string | null {
    return read(REFRESH_KEY);
  },
  set(access: string, refresh: string): void {
    write(ACCESS_KEY, access);
    write(REFRESH_KEY, refresh);
  },
  clear(): void {
    write(ACCESS_KEY, null);
    write(REFRESH_KEY, null);
  },
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // Private mode, or storage disabled. Signed out is the honest answer.
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Nothing to do — the session just will not survive a reload.
  }
}

export class ApiError extends Error {
  // Fields declared and assigned separately: the project compiles with
  // `erasableSyntaxOnly`, which rules out parameter properties.
  readonly status: number;
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Serialised as JSON. Mutually exclusive with `form`. */
  body?: unknown;
  /** Sent as multipart — `/lessions/check-text` wants a form, not JSON. */
  form?: Record<string, string>;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Skips the bearer header, for the two endpoints that must not carry one. */
  anonymous?: boolean;
  timeoutMs?: number;
}

/** Long enough for the LLM classifier — see the note in `lesson-api.ts`. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One request, with a bearer token and a single retry after a refresh.
 *
 * The refresh is single-flight: a lesson can have a grade call and a data write
 * in the air at once, and two parallel refreshes would race, each invalidating
 * the other's freshly-issued refresh token.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);

  if (response.status === 401 && !options.anonymous && tokenStore.refresh) {
    const refreshed = await refreshTokens();
    if (refreshed) return unwrap<T>(await send(path, options));
  }

  return unwrap<T>(response);
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  const token = tokenStore.access;
  if (!options.anonymous && token) headers.Authorization = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (options.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.form)) form.append(key, value);
    body = form;
    // Deliberately no Content-Type: the browser has to set it so the multipart
    // boundary matches the body it just built.
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  // An AbortSignal from the caller and our own timeout both need to cancel the
  // same request, so they are combined rather than one winning.
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  return fetch(url, { method: options.method ?? 'GET', headers, body, signal });
}

async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  const json: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const detail = isRecord(json) ? json : {};
    throw new ApiError(
      String(detail.message ?? `HTTP ${response.status}`),
      response.status,
      typeof detail.code === 'string' ? detail.code : undefined,
    );
  }

  // The backend wraps most payloads as `{success, data}` but returns login and
  // refresh flat. Unwrapping when `data` is present covers both without the
  // caller having to know which shape it asked for.
  if (isRecord(json) && 'data' in json) return json.data as T;
  return json as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/** Swaps the refresh token for a new pair. Shared by every concurrent caller. */
export function refreshTokens(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const refresh = tokenStore.refresh;
  if (!refresh) return false;
  try {
    const response = await send('/auth/refresh', {
      method: 'POST',
      body: { refresh_token: refresh },
      anonymous: true,
    });
    if (!response.ok) {
      // The refresh token itself is dead — there is no recovering from here,
      // so clear both rather than retrying with a token we know is rejected.
      tokenStore.clear();
      return false;
    }
    const json = (await response.json()) as Record<string, unknown>;
    const access = json.access_token;
    const next = json.refresh_token;
    if (typeof access !== 'string' || typeof next !== 'string') return false;
    tokenStore.set(access, next);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
