import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useSimulatorStore } from '../store/simulator-store';
import {
  fetchProfile,
  hasStoredSession,
  listChildren,
  loginAndBind,
  logout,
  registerAndBindDevice,
  type Account,
  type ChildItem,
} from '../api/auth-client';

export function QrPairingModal() {
  const open = useSimulatorStore((state) => state.loginModalOpen);
  const setOpen = useSimulatorStore((state) => state.setLoginModalOpen);
  const config = useSimulatorStore((state) => state.config);
  const connect = useSimulatorStore((state) => state.connect);

  const [activeTab, setActiveTab] = useState<'qr' | 'login'>('qr');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Auth & Bind state
  const [account, setAccount] = useState<Account | null>(null);
  const [children, setChildren] = useState<ChildItem[]>([]);
  const [phone, setPhone] = useState('+84123456789');
  const [password, setPassword] = useState('123456');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const qrPayload = JSON.stringify({
    type: 'bong_device',
    device_id: config.macAddress,
    name: config.deviceName || 'Robot Bống',
    model: 'round-badge',
  });

  const parentPairUrl = `http://localhost:5173/profile?tab=devices&pair_device=${encodeURIComponent(
    config.macAddress
  )}`;

  // Generate QR Code
  useEffect(() => {
    if (open) {
      QRCode.toDataURL(qrPayload, {
        width: 240,
        margin: 2,
        color: {
          dark: '#2c1e19',
          light: '#ffffff',
        },
      })
        .then(setQrDataUrl)
        .catch(console.error);
    }
  }, [open, qrPayload]);

  // Load current session
  useEffect(() => {
    if (!open) return;
    setMessage(null);
    if (hasStoredSession()) {
      void fetchProfile()
        .then((acc) => {
          setAccount(acc);
          if (acc.child?.id) setSelectedChildId(acc.child.id);
          return listChildren();
        })
        .then((kids) => {
          setChildren(kids);
        })
        .catch(() => {
          setAccount(null);
        });
    } else {
      setAccount(null);
      setChildren([]);
    }
  }, [open]);

  if (!open) return null;

  const handleCopyMac = () => {
    navigator.clipboard.writeText(config.macAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoginAndBind = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const res = await loginAndBind(
        phone.trim(),
        password,
        config.macAddress,
        selectedChildId || undefined
      );
      setAccount(res.account);
      setChildren(res.children);
      if (res.account.child?.id) {
        setSelectedChildId(res.account.child.id);
      }

      // Reconnect WebSocket so xiaozhi-server picks up the bound child name!
      connect();

      setMessage({
        type: 'success',
        text: `Đã đăng nhập và gán thiết bị (${config.macAddress}) thành công cho ${
          res.account.child?.name ? `Bé ${res.account.child.name}` : 'tài khoản'
        }!`,
      });
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message || 'Không thể đăng nhập hoặc gắn thiết bị.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRebindChild = async (childId: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await registerAndBindDevice(config.macAddress, childId, 'Robot Bống');
      setSelectedChildId(childId);
      const updated = await fetchProfile();
      setAccount(updated);

      // Refresh connection
      connect();

      const kid = children.find((c) => c.id === childId);
      setMessage({
        type: 'success',
        text: `Đã chuyển thiết bị sang Bé ${kid?.name || 'mới'}!`,
      });
    } catch (err: any) {
      setMessage({
        type: 'error',
        text: err?.message || 'Lỗi khi gán lại bé.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = () => {
    logout();
    setAccount(null);
    setChildren([]);
    setMessage({ type: 'success', text: 'Đã đăng xuất tài khoản.' });
    connect();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={() => setOpen(false)}
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl p-6 text-center space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="absolute right-4 top-4 text-ink-300 hover:text-ink-600 font-bold text-xl leading-none"
        >
          ×
        </button>

        <div className="space-y-1">
          <span className="inline-block text-3xl">🧸</span>
          <h2 className="text-lg font-black text-ink-900">Kết Nối & Gán Thiết Bị</h2>
          <p className="text-xs text-ink-500">
            Trình giả lập thiết bị Robot Bống ({config.macAddress})
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex rounded-2xl bg-cream-100 p-1 text-xs font-bold text-ink-600">
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`flex-1 py-1.5 rounded-xl transition ${
              activeTab === 'qr'
                ? 'bg-white text-coral-600 shadow-sm'
                : 'hover:text-ink-900'
            }`}
          >
            📱 Mã QR
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('login')}
            className={`flex-1 py-1.5 rounded-xl transition ${
              activeTab === 'login'
                ? 'bg-white text-coral-600 shadow-sm'
                : 'hover:text-ink-900'
            }`}
          >
            ⚡ Đăng nhập & Gán nhanh
          </button>
        </div>

        {/* Notification Message */}
        {message && (
          <div
            className={`p-3 rounded-xl text-xs font-semibold text-left border ${
              message.type === 'success'
                ? 'bg-mint-400/15 text-mint-700 border-mint-400/30'
                : 'bg-coral-500/10 text-coral-600 border-coral-500/20'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* TAB 1: QR CODE */}
        {activeTab === 'qr' && (
          <div className="space-y-3">
            <div className="flex justify-center my-1">
              <div className="p-3 bg-white rounded-2xl border-2 border-dashed border-coral-200 shadow-inner flex flex-col items-center">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="QR Code Thiết bị"
                    className="w-48 h-48 object-contain rounded-lg"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-xs text-ink-400 animate-pulse">
                    Đang tạo mã QR...
                  </div>
                )}
              </div>
            </div>

            {/* MAC info & Copy */}
            <div className="bg-cream-100 rounded-xl p-3 space-y-1 text-left border border-cream-200">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-ink-500 uppercase tracking-wider">
                  Mã thiết bị (MAC)
                </span>
                <button
                  type="button"
                  onClick={handleCopyMac}
                  className="text-[11px] font-bold text-coral-600 hover:text-coral-700 active:scale-95 transition"
                >
                  {copied ? '✓ Đã chép' : '📋 Sao chép'}
                </button>
              </div>
              <p className="font-mono text-xs font-bold text-ink-900 bg-white px-2 py-1 rounded-lg border border-cream-300">
                {config.macAddress}
              </p>
            </div>

            <div className="space-y-2 pt-1">
              <a
                href={parentPairUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-1.5 w-full py-2.5 px-4 rounded-xl bg-coral-500 hover:bg-coral-600 text-white font-bold text-xs shadow-md shadow-coral-500/20 active:scale-95 transition"
              >
                <span>🚀</span>
                <span>Mở trang Phụ Huynh để liên kết ngay</span>
              </a>

              <button
                type="button"
                onClick={() => connect()}
                className="w-full py-2 px-3 rounded-xl bg-cream-200 hover:bg-cream-300 text-ink-700 font-semibold text-xs transition"
              >
                ⟳ Làm mới kết nối thiết bị
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: DEV QUICK LOGIN & BIND */}
        {activeTab === 'login' && (
          <div className="space-y-3 text-left">
            {account ? (
              <div className="space-y-3">
                <div className="bg-mint-400/10 rounded-2xl p-4 border border-mint-400/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-mint-800">
                      👨‍👩‍👧 {account.name || 'Phụ huynh'}
                    </span>
                    <span className="text-[10px] font-mono text-mint-600">{account.phone}</span>
                  </div>

                  <div className="pt-2 border-t border-mint-400/20">
                    <span className="text-[11px] font-bold text-ink-600 block mb-1">
                      👶 Gán thiết bị cho bé:
                    </span>
                    {children.length > 0 ? (
                      <select
                        value={selectedChildId}
                        onChange={(e) => handleRebindChild(e.target.value)}
                        disabled={busy}
                        className="w-full rounded-xl bg-white border border-mint-400/40 px-3 py-2 text-xs font-bold text-ink-900 outline-none"
                      >
                        {children.map((c) => (
                          <option key={c.id} value={c.id}>
                            Bé {c.name} {c.nickname ? `(${c.nickname})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-xs text-ink-500 italic">Chưa có hồ sơ bé</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => connect()}
                    disabled={busy}
                    className="flex-1 py-2 rounded-xl bg-cream-200 hover:bg-cream-300 text-ink-700 font-bold text-xs transition"
                  >
                    ⟳ Reconnect Socket
                  </button>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    disabled={busy}
                    className="py-2 px-4 rounded-xl bg-coral-500/10 hover:bg-coral-500/20 text-coral-600 font-bold text-xs transition"
                  >
                    Đăng xuất
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleLoginAndBind} className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-ink-600 uppercase mb-1">
                    Số điện thoại
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="+84123456789"
                    className="w-full rounded-xl bg-cream-100 border border-cream-300 px-3 py-2 text-xs font-mono text-ink-900 outline-none focus:ring-2 focus:ring-coral-400"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-ink-600 uppercase mb-1">
                    Mật khẩu
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••"
                    className="w-full rounded-xl bg-cream-100 border border-cream-300 px-3 py-2 text-xs font-mono text-ink-900 outline-none focus:ring-2 focus:ring-coral-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 rounded-xl bg-coral-500 hover:bg-coral-600 disabled:opacity-50 text-white font-bold text-xs shadow-md shadow-coral-500/20 active:scale-95 transition"
                >
                  {busy ? 'Đang liên kết thiết bị...' : '⚡ Đăng nhập & Gán thiết bị cho bé'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
