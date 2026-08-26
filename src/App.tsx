import { useState, useEffect } from 'react';
import { RoundScreen } from './screen/round-screen';
import { BongBubble } from './screen/speech-bubble';
import { TalkBar } from './dev/talk-bar';
import { DevDrawer } from './dev/dev-drawer';
import { LoginModal } from './dev/login-modal';
import { useSimulatorStore } from './store/simulator-store';
import { fetchProfile, hasStoredSession, type Account } from './api/auth-client';

/**
 * The badge, centre stage.
 *
 * Everything that is not the device lives behind the Dev button. What is being
 * demonstrated here is a toy a small child talks to, and it should look like
 * one — the packet log is for the person building it, not the person seeing it.
 */
export default function App() {
  const [devOpen, setDevOpen] = useState(false);
  const setLoginOpen = useSimulatorStore((state) => state.setLoginModalOpen);

  return (
    <main className="flex min-h-screen flex-col">
      <Header onOpenDev={() => setDevOpen(true)} onOpenLogin={() => setLoginOpen(true)} />

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-12">
        <RoundScreen />
        <BongBubble />
        <TalkBar />
      </div>

      <DevDrawer open={devOpen} onClose={() => setDevOpen(false)} />
      <LoginModal />
    </main>
  );
}

function Header({ onOpenDev, onOpenLogin }: { onOpenDev: () => void; onOpenLogin: () => void }) {
  const [account, setAccount] = useState<Account | null>(null);
  const loginModalOpen = useSimulatorStore((state) => state.loginModalOpen);

  useEffect(() => {
    if (hasStoredSession()) {
      void fetchProfile()
        .then(setAccount)
        .catch(() => setAccount(null));
    } else {
      setAccount(null);
    }
  }, [loginModalOpen]);

  return (
    <header className="flex items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-coral-500 text-lg shadow-[0_6px_14px_-6px_rgba(255,107,74,0.9)]">
          🧸
        </span>
        <div className="leading-tight">
          <p className="font-bold text-ink-900">Bống</p>
          <p className="text-xs text-ink-500">Trình giả lập thiết bị</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenLogin}
          className={`flex items-center gap-1.5 rounded-blob px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
            account
              ? 'bg-mint-400/15 text-mint-500 hover:bg-mint-400/25'
              : 'bg-coral-500 text-white shadow-[0_4px_12px_-4px_rgba(255,107,74,0.7)] hover:bg-coral-600 active:scale-95'
          }`}
        >
          <span>{account ? '👨‍👩‍👧' : '🔑'}</span>
          <span>{account ? (account.child?.name ? `Bé ${account.child.name}` : account.name || 'Phụ huynh') : 'Đăng nhập'}</span>
        </button>

        <StatusPill />
        <button
          type="button"
          onClick={onOpenDev}
          className="rounded-blob bg-white px-4 py-2 text-sm font-bold text-ink-700 shadow-[0_6px_16px_-10px_rgba(61,44,36,0.6)] transition hover:bg-cream-100 active:scale-95"
        >
          Kỹ thuật
        </button>
      </div>
    </header>
  );
}

/** Connection state, small and out of the way until it is bad news. */
function StatusPill() {
  const status = useSimulatorStore((state) => state.status);

  const label = {
    connected: 'đã kết nối',
    connecting: 'đang kết nối',
    disconnected: 'chưa kết nối',
  }[status];

  const tone = {
    connected: 'bg-mint-400/20 text-mint-500',
    connecting: 'bg-sunny-400/25 text-ink-700',
    disconnected: 'bg-cream-200 text-ink-500',
  }[status];

  const dot = {
    connected: 'bg-mint-400',
    connecting: 'bg-sunny-400 animate-pulse',
    disconnected: 'bg-ink-300',
  }[status];

  return (
    <span className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${tone}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
