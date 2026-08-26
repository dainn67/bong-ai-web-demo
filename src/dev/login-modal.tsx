import { useEffect, useState } from 'react';
import {
  fetchProfile,
  hasStoredSession,
  login,
  logout,
  type Account,
} from '../api/auth-client';
import { useSimulatorStore } from '../store/simulator-store';

export function LoginModal() {
  const open = useSimulatorStore((state) => state.loginModalOpen);
  const setOpen = useSimulatorStore((state) => state.setLoginModalOpen);
  const config = useSimulatorStore((state) => state.config);
  const reportCondition = useSimulatorStore((state) => state.reportCondition);

  const [account, setAccount] = useState<Account | null>(null);
  const [phone, setPhone] = useState('0123456789');
  const [password, setPassword] = useState('password123');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (hasStoredSession()) {
      void fetchProfile()
        .then((acc) => setAccount(acc))
        .catch(() => setAccount(null));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const handleLogin = async (overridePhone?: string, overridePass?: string) => {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const loginPhone = overridePhone ?? phone;
      const loginPass = overridePass ?? password;
      const acc = await login(loginPhone.trim(), loginPass, config.macAddress);
      setAccount(acc);
      setSuccessMsg(`Đã liên kết thiết bị thành công cho bé ${acc.child?.name || 'Bé Bống'}!`);
      // Retry telemetry sync immediately
      setTimeout(() => {
        reportCondition();
        setTimeout(() => setOpen(false), 1200);
      }, 500);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    logout();
    setAccount(null);
    setSuccessMsg(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        className="fixed inset-0 bg-ink-900/40 backdrop-blur-xs transition-opacity animate-fade-in"
      />

      {/* Modal Card */}
      <div className="relative z-10 w-full max-w-md rounded-blob bg-white p-6 shadow-[0_20px_50px_-15px_rgba(61,44,36,0.4)] transition-all">
        {/* Close Button */}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-cream-100 text-ink-500 transition hover:bg-cream-200 hover:text-ink-900"
          title="Đóng"
        >
          ✕
        </button>

        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-coral-500 text-2xl shadow-[0_6px_14px_-6px_rgba(255,107,74,0.9)]">
            🧸
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink-900">Đăng nhập Bống AI</h2>
            <p className="text-xs text-ink-500">
              Liên kết thiết bị <code className="rounded bg-cream-100 px-1 py-0.5 font-mono font-bold text-coral-600">{config.macAddress}</code>
            </p>
          </div>
        </div>

        {/* Content */}
        {account ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-cream-50 p-4 border border-cream-200">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-500">Tài khoản hiện tại</p>
              <p className="mt-1 font-bold text-ink-900">{account.name || 'Phụ huynh'} ({account.phone})</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-700">
                <span>Bé: <strong>{account.child?.name || 'Chưa gắn'}</strong></span>
                <span>•</span>
                <span className="capitalize">Gói: <strong>{account.subscriptionStatus || 'active'}</strong></span>
              </div>
            </div>

            {successMsg && (
              <div className="rounded-xl bg-mint-400/20 p-3 text-xs font-bold text-mint-500 text-center">
                ✓ {successMsg}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleLogin(account.phone, 'password123')}
                disabled={busy}
                className="flex-1 rounded-xl bg-coral-500 py-2.5 text-sm font-bold text-white shadow transition hover:bg-coral-600 disabled:opacity-50"
              >
                {busy ? 'Đang bind...' : 'Re-bind thiết bị này'}
              </button>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-xl bg-cream-100 px-4 py-2.5 text-sm font-bold text-ink-700 transition hover:bg-cream-200"
              >
                Đăng xuất
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-ink-500">
              Thiết bị chưa được liên kết trong hệ thống. Đăng nhập tài khoản phụ huynh để tự động kích hoạt và bắt đầu học bài / trò chuyện cùng Bống.
            </p>

            {error && (
              <div className="rounded-xl bg-berry-500/15 p-3 text-xs font-semibold text-berry-500">
                ✕ {error}
              </div>
            )}

            {successMsg && (
              <div className="rounded-xl bg-mint-400/20 p-3 text-xs font-bold text-mint-500">
                ✓ {successMsg}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div>
                <label className="text-xs font-bold text-ink-700">Số điện thoại</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="0123456789"
                  inputMode="tel"
                  autoComplete="username"
                  className="mt-1 w-full rounded-xl bg-cream-100 px-3.5 py-2.5 text-sm outline-none ring-coral-400 transition focus:ring-2"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-ink-700">Mật khẩu</label>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleLogin()}
                  placeholder="••••••••"
                  type="password"
                  autoComplete="current-password"
                  className="mt-1 w-full rounded-xl bg-cream-100 px-3.5 py-2.5 text-sm outline-none ring-coral-400 transition focus:ring-2"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => handleLogin()}
              disabled={busy || !phone || !password}
              className="mt-2 w-full rounded-xl bg-coral-500 py-3 text-sm font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,107,74,0.8)] transition hover:bg-coral-600 active:scale-98 disabled:opacity-50"
            >
              {busy ? 'Đang xác thực & liên kết...' : 'Đăng nhập & Kích hoạt thiết bị'}
            </button>

            <div className="relative my-1 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-cream-200"></div></div>
              <span className="relative bg-white px-2 text-[11px] font-semibold text-ink-300">HOẶC TEST NHANH</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setPhone('0123456789');
                setPassword('password123');
                void handleLogin('0123456789', 'password123');
              }}
              disabled={busy}
              className="w-full rounded-xl bg-cream-100 py-2 text-xs font-bold text-ink-700 transition hover:bg-cream-200 disabled:opacity-50"
            >
              ⚡ 1-Click Đăng nhập Demo Parent (0123456789)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
