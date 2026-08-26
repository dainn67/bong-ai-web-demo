/**
 * Parent sign-in — in the drawer, never on the badge.
 *
 * Real firmware authenticates with a MAC address and a device token; there is
 * no login form on a badge and there never will be. This is here because the
 * *lesson content* needs a parent account: `{userPhone}` and `{voiceID}` appear
 * in two thirds of a lesson's clip URLs, and without them those clips are
 * silently skipped and the lesson plays mostly silence.
 *
 * So this panel belongs to the same family as the packet inspector — a test
 * harness holding a credential the simulated device does not have.
 */

import { useEffect, useState } from 'react';
import { Panel } from './dev-drawer';
import {
  fetchProfile,
  hasActiveSubscription,
  hasStoredSession,
  login,
  logout,
  type Account,
} from '../api/auth-client';
import { loadConfig } from '../config/device-config';

export function AuthPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A token in storage outlives the page, so restore the session on mount
  // rather than making the tester sign in after every reload.
  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    void fetchProfile()
      .then((loaded) => !cancelled && setAccount(loaded))
      .catch(() => !cancelled && logout());
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const config = loadConfig();
      setAccount(await login(phone.trim(), password, config.macAddress));
      setPassword('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    logout();
    setAccount(null);
  };

  return (
    <Panel
      title="Tài khoản"
      action={
        account && (
          <button
            type="button"
            onClick={signOut}
            className="text-xs font-semibold text-ink-500 underline underline-offset-2"
          >
            Đăng xuất
          </button>
        )
      }
    >
      {account ? <Signed account={account} /> : null}

      {!account && (
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-snug text-ink-500">
            Bài học cần tài khoản phụ huynh — 2/3 số clip có <code>{'{userPhone}'}</code> hoặc{' '}
            <code>{'{voiceID}'}</code> trong URL. Truyện và trò chuyện thì không cần.
          </p>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="Số điện thoại"
            inputMode="tel"
            autoComplete="username"
            className="rounded-xl bg-cream-100 px-3 py-2 text-sm outline-none ring-coral-400 focus:ring-2"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void submit()}
            placeholder="Mật khẩu"
            type="password"
            autoComplete="current-password"
            className="rounded-xl bg-cream-100 px-3 py-2 text-sm outline-none ring-coral-400 focus:ring-2"
          />
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !phone.trim() || !password}
            className="rounded-xl bg-coral-500 px-3 py-2 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
          >
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
          </button>
          {error && <p className="text-xs font-medium text-berry-500">{error}</p>}
        </div>
      )}
    </Panel>
  );
}

/**
 * What is shown once signed in.
 *
 * These five lines are chosen on purpose. The subscription date is the one that
 * earns its place: every `/lessions/*` route sits behind an active-subscription
 * check, so a lapsed one makes grading fail in a way that looks exactly like a
 * bug. The voice and volume are the values that get substituted into clip URLs,
 * so seeing them is how you tell a silent lesson from a missing account.
 */
function Signed({ account }: { account: Account }) {
  const active = hasActiveSubscription(account);
  const expires = account.subscriptionExpiresAt
    ? new Date(account.subscriptionExpiresAt).toLocaleDateString('vi-VN')
    : null;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <Field label="Phụ huynh" value={account.phone} />
      <Field label="Bé" value={account.child?.nickname ?? account.child?.name ?? '—'} />
      <Field
        label="Thuê bao"
        value={active ? `còn hạn${expires ? ` đến ${expires}` : ''}` : 'hết hạn'}
        tone={active ? 'ok' : 'bad'}
      />
      <Field label="voiceID" value={account.voiceId ?? '—'} tone={account.voiceId ? 'ok' : 'bad'} />
      <Field label="bongVolume" value={account.bongVolume === null ? '—' : `${account.bongVolume}`} />
    </dl>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'bad';
}) {
  const colour = tone === 'bad' ? 'text-berry-500' : tone === 'ok' ? 'text-mint-500' : 'text-ink-700';
  return (
    <>
      <dt className="font-semibold text-ink-500">{label}</dt>
      <dd className={`truncate font-medium ${colour}`}>{value}</dd>
    </>
  );
}
