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
  listChildren,
  loginAndBind,
  logout,
  registerAndBindDevice,
  type Account,
  type ChildItem,
} from '../api/auth-client';
import { loadConfig } from '../config/device-config';
import { useSimulatorStore } from '../store/simulator-store';

export function AuthPanel() {
  const [account, setAccount] = useState<Account | null>(null);
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [phone, setPhone] = useState('+84123456789');
  const [password, setPassword] = useState('123456');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connect = useSimulatorStore((state) => state.connect);

  // Restore session
  useEffect(() => {
    if (!hasStoredSession()) return;
    let cancelled = false;
    void fetchProfile()
      .then(async (loaded) => {
        if (cancelled) return;
        setAccount(loaded);
        const kids = await listChildren().catch(() => []);
        if (!cancelled) setChildren(kids);
      })
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
      const res = await loginAndBind(phone.trim(), password, config.macAddress);
      setAccount(res.account);
      setChildren(res.children);
      setPassword('');
      connect();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const switchChild = async (childId: string) => {
    setBusy(true);
    setError(null);
    try {
      const config = loadConfig();
      await registerAndBindDevice(config.macAddress, childId, 'Robot Bống');
      const updated = await fetchProfile();
      setAccount(updated);
      connect();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    logout();
    setAccount(null);
    setChildren([]);
    connect();
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
      {account ? (
        <Signed
          account={account}
          childrenList={children}
          onSwitchChild={switchChild}
          busy={busy}
        />
      ) : null}

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
            {busy ? 'Đang đăng nhập & gán…' : 'Đăng nhập & Gán thiết bị'}
          </button>
          {error && <p className="text-xs font-medium text-berry-500">{error}</p>}
        </div>
      )}
    </Panel>
  );
}

/**
 * What is shown once signed in.
 */
function Signed({
  account,
  childrenList,
  onSwitchChild,
  busy,
}: {
  account: Account;
  childrenList: ChildItem[];
  onSwitchChild: (childId: string) => void;
  busy: boolean;
}) {
  const active = hasActiveSubscription(account);
  const expires = account.subscriptionExpiresAt
    ? new Date(account.subscriptionExpiresAt).toLocaleDateString('vi-VN')
    : null;

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <Field label="Phụ huynh" value={account.phone} />
        <Field label="Bé hiện tại" value={account.child?.nickname ?? account.child?.name ?? '—'} />
        <Field
          label="Thuê bao"
          value={active ? `còn hạn${expires ? ` đến ${expires}` : ''}` : 'hết hạn'}
          tone={active ? 'ok' : 'bad'}
        />
        <Field label="voiceID" value={account.voiceId ?? '—'} tone={account.voiceId ? 'ok' : 'bad'} />
        <Field label="bongVolume" value={account.bongVolume === null ? '—' : `${account.bongVolume}`} />
      </dl>

      {childrenList.length > 1 && (
        <div className="pt-2 border-t border-cream-200">
          <label className="block text-[11px] font-bold text-ink-600 mb-1">
            Đổi bé gán với thiết bị này:
          </label>
          <select
            value={account.child?.id || ''}
            onChange={(e) => onSwitchChild(e.target.value)}
            disabled={busy}
            className="w-full rounded-xl bg-cream-100 border border-cream-300 px-3 py-1.5 text-xs font-bold text-ink-900 outline-none"
          >
            {childrenList.map((c) => (
              <option key={c.id} value={c.id}>
                Bé {c.name} {c.nickname ? `(${c.nickname})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
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
