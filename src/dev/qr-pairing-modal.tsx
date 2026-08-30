import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useSimulatorStore } from '../store/simulator-store';

export function QrPairingModal() {
  const open = useSimulatorStore((state) => state.loginModalOpen);
  const setOpen = useSimulatorStore((state) => state.setLoginModalOpen);
  const config = useSimulatorStore((state) => state.config);
  const connect = useSimulatorStore((state) => state.connect);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const qrPayload = JSON.stringify({
    type: 'bong_device',
    device_id: config.macAddress,
    name: config.deviceName || 'Robot Bống',
    model: 'round-badge',
  });

  const parentPairUrl = `http://localhost:5173/profile?tab=devices&pair_device=${encodeURIComponent(
    config.macAddress
  )}`;

  useEffect(() => {
    if (open) {
      QRCode.toDataURL(qrPayload, {
        width: 260,
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

  if (!open) return null;

  const handleCopyMac = () => {
    navigator.clipboard.writeText(config.macAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRefreshConnection = () => {
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
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl p-6 text-center space-y-4"
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
          <span className="inline-block text-3xl">📱</span>
          <h2 className="text-lg font-black text-ink-900">Mã QR Kết Nối Thiết Bị</h2>
          <p className="text-xs text-ink-500">
            Dùng app Bống AI của Phụ huynh để quét mã này và gán cho bé yêu
          </p>
        </div>

        {/* QR Code Container */}
        <div className="flex justify-center my-2">
          <div className="p-3 bg-white rounded-2xl border-2 border-dashed border-coral-200 shadow-inner flex flex-col items-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QR Code Thiết bị"
                className="w-52 h-52 object-contain rounded-lg"
              />
            ) : (
              <div className="w-52 h-52 flex items-center justify-center text-xs text-ink-400 animate-pulse">
                Đang tạo mã QR...
              </div>
            )}
          </div>
        </div>

        {/* MAC Address info & Copy */}
        <div className="bg-cream-100 rounded-xl p-3 space-y-1.5 text-left border border-cream-200">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-ink-500 uppercase tracking-wider">
              Mã thiết bị (MAC)
            </span>
            <button
              type="button"
              onClick={handleCopyMac}
              className="text-[11px] font-bold text-coral-600 hover:text-coral-700 active:scale-95 transition"
            >
              {copied ? '✓ Đã sao chép' : '📋 Sao chép'}
            </button>
          </div>
          <p className="font-mono text-xs font-bold text-ink-900 bg-white px-2.5 py-1.5 rounded-lg border border-cream-300">
            {config.macAddress}
          </p>
        </div>

        {/* Quick Dev Action */}
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
            onClick={handleRefreshConnection}
            className="w-full py-2 px-3 rounded-xl bg-cream-200 hover:bg-cream-300 text-ink-700 font-semibold text-xs transition"
          >
            ⟳ Làm mới kết nối thiết bị
          </button>
        </div>
      </div>
    </div>
  );
}
