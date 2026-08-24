/**
 * Signing in as a parent, so lessons can resolve their audio.
 *
 * The reason this exists at all is worth restating: two thirds of the clips in
 * a real lesson carry `{userPhone}` or `{voiceID}` in the URL. Without an
 * account those clips do not 404 — they are silently skipped, and the lesson
 * plays mostly silence. Login is not about the grading endpoints; it is about
 * being able to build the URLs.
 */

import { request, tokenStore } from './api-client';

/** Everything a lesson needs from the signed-in parent. */
export interface Account {
  userId: string;
  phone: string;
  name: string | null;
  /** Fills `{voiceID}` in lesson clip paths. Not the live-chat voice. */
  voiceId: string | null;
  /** Fills the `{bongVolume}` volume placeholder. */
  bongVolume: number | null;
  aiNickname: string;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
  child: { id: string; name: string; nickname: string | null } | null;
}

/** True when the lesson APIs will actually answer — they all require this. */
export function hasActiveSubscription(account: Account | null): boolean {
  if (!account) return false;
  if (!account.subscriptionExpiresAt) return account.subscriptionStatus === 'active';
  return new Date(account.subscriptionExpiresAt).getTime() > Date.now();
}

interface LoginResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  user?: unknown;
}

export async function login(phone: string, password: string): Promise<Account> {
  const json = await request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { phone, password },
    anonymous: true,
  });

  if (typeof json.access_token !== 'string' || typeof json.refresh_token !== 'string') {
    throw new Error('Máy chủ không trả về token');
  }
  tokenStore.set(json.access_token, json.refresh_token);

  // The login payload carries a user, but the token-scoped profile is the
  // authoritative one — same reasoning as the app, which always re-fetches.
  try {
    return await fetchProfile();
  } catch {
    return parseAccount(json.user);
  }
}

export async function fetchProfile(): Promise<Account> {
  return parseAccount(await request<unknown>('/profile'));
}

export function logout(): void {
  tokenStore.clear();
}

export function hasStoredSession(): boolean {
  return tokenStore.access !== null;
}

/** Maps the backend's snake_case user object onto {@link Account}. */
export function parseAccount(raw: unknown): Account {
  if (!isRecord(raw)) throw new Error('Không đọc được thông tin tài khoản');

  const children = Array.isArray(raw.children) ? raw.children : [];
  const first = children.find(isRecord) ?? null;

  return {
    userId: String(raw.id ?? raw.user_id ?? ''),
    phone: String(raw.phone ?? ''),
    name: asString(raw.name),
    voiceId: asString(raw.voice_id),
    bongVolume: typeof raw.bong_volume === 'number' ? raw.bong_volume : null,
    aiNickname: asString(raw.ai_nickname) ?? 'Bống',
    subscriptionStatus: asString(raw.subscription_status),
    subscriptionExpiresAt: asString(raw.subscription_expired_at),
    // V1 is one child per account; the app takes the first and so do we.
    child: first
      ? {
          id: String(first.id ?? ''),
          name: String(first.name ?? ''),
          nickname: asString(first.nickname),
        }
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
