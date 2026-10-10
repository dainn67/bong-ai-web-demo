import { useState, useEffect } from 'react';
import { RoundScreen } from './screen/round-screen';
import { BongBubble } from './screen/speech-bubble';
import { TalkBar } from './dev/talk-bar';
import { DevDrawer } from './dev/dev-drawer';
import { QrPairingModal } from './dev/qr-pairing-modal';
import { ScriptEnginePanel } from './v3/script-engine-panel';
import { TalkSimulatorPanel } from './v3/talk-simulator-panel';
import { V3EngineProvider } from './v3/v3-engine-context';
import { useSimulatorStore } from './store/simulator-store';
import { fetchProfile, hasStoredSession, type Account } from './api/auth-client';
import { QaAcceptanceModal } from './dev/qa-acceptance-modal';
import { unlockSharedAudioContext } from './v3/use-script-engine';

/**
 * The badge, centre stage or studio mode.
 *
 * Wraps with V3EngineProvider so the V3 Offline-First Script Engine runs
 * continuously in the background at root level. Interactions happen directly
 * on the simulated round hardware device.
 */
export default function App() {
  return (
    <V3EngineProvider>
      <AppContent />
    </V3EngineProvider>
  );
}

function AppContent() {
  const [devOpen, setDevOpen] = useState(false);
  const [qaModalOpen, setQaModalOpen] = useState(false);
  const showLessonPanel = useSimulatorStore((state) => state.showLessonPanel);
  const setShowLessonPanel = useSimulatorStore((state) => state.setShowLessonPanel);
  const lessonEngineType = useSimulatorStore((state) => state.lessonEngineType);
  const setLessonEngineType = useSimulatorStore((state) => state.setLessonEngineType);
  const setLoginOpen = useSimulatorStore((state) => state.setLoginModalOpen);

  useEffect(() => {
    // Auto-connect to Xiaozhi Gateway on startup
    useSimulatorStore.getState().connect();

    // Global user-gesture audio unlock for web browser autoplay policy
    const handleGesture = () => {
      unlockSharedAudioContext();
    };
    window.addEventListener('pointerdown', handleGesture, { capture: true });
    window.addEventListener('keydown', handleGesture, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture, { capture: true });
      window.removeEventListener('keydown', handleGesture, { capture: true });
    };
  }, []);

  return (
    <main
      className={`flex min-h-screen flex-col transition-[padding] duration-300 ease-out ${
        devOpen ? 'lg:pr-[26rem]' : ''
      }`}
    >
      <Header
        devOpen={devOpen}
        onToggleDev={() => setDevOpen((open) => !open)}
        onOpenLogin={() => setLoginOpen(true)}
        onOpenQa={() => setQaModalOpen(true)}
      />

      {showLessonPanel ? (
        <div className="flex flex-1 flex-col lg:flex-row gap-8 px-6 pb-12 max-w-7xl mx-auto w-full">
          {/* Left Column: Device Screen */}
          <div className="flex flex-col items-center justify-start gap-6 lg:w-[400px] shrink-0">
            <div className="sticky top-6 flex flex-col items-center gap-6">
              <RoundScreen />
              <BongBubble />
              <TalkBar />
            </div>
          </div>

          {/* Right Column: Studio Panel */}
          <div className="flex-1 min-w-0">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 p-1 bg-cream-200/80 rounded-xl text-xs font-bold border border-cream-300">
                <button
                  type="button"
                  onClick={() => setLessonEngineType('v3')}
                  className={`rounded-lg px-3.5 py-1.5 transition ${
                    lessonEngineType !== 'talk_v3'
                      ? 'bg-indigo-600 text-white shadow-sm font-black'
                      : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  ⚡ Kịch bản Bống v3 (Offline-First)
                </button>
                <button
                  type="button"
                  onClick={() => setLessonEngineType('talk_v3')}
                  className={`rounded-lg px-3.5 py-1.5 transition ${
                    lessonEngineType === 'talk_v3'
                      ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                      : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  🎙️ Đàm thoại tự do Free Talk v3
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowLessonPanel(false)}
                className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 font-bold px-2.5 py-1 rounded-lg hover:bg-cream-200 transition"
                title="Ẩn bảng kiểm thử kịch bản"
              >
                ✕ Ẩn bảng
              </button>
            </div>

            {lessonEngineType === 'talk_v3' ? (
              <TalkSimulatorPanel />
            ) : (
              <ScriptEnginePanel />
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-12">
          {/* Main Mode Switcher: Offline Lesson vs. Free Talk with Xiaozhi AI */}
          <div className="flex items-center gap-1.5 p-1 bg-cream-200/90 rounded-2xl text-xs font-bold border border-cream-300 shadow-xs">
            <button
              type="button"
              onClick={() => setLessonEngineType('v3')}
              className={`rounded-xl px-4 py-1.5 transition ${
                lessonEngineType !== 'talk_v3'
                  ? 'bg-indigo-600 text-white shadow-sm font-black'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              ⚡ Kịch bản Bống v3 (Offline)
            </button>
            <button
              type="button"
              onClick={() => setLessonEngineType('talk_v3')}
              className={`rounded-xl px-4 py-1.5 transition ${
                lessonEngineType === 'talk_v3'
                  ? 'bg-gradient-to-r from-amber-500 to-coral-500 text-white font-black shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              🎙️ Trò Chuyện Tự Do (Xiaozhi AI)
            </button>
          </div>

          <RoundScreen />
          <BongBubble />
          <TalkBar />
          {/* Subtle hardware badge tips */}
          <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-ink-500 font-medium bg-cream-200/60 px-5 py-2 rounded-full border border-cream-300/80 shadow-sm">
            <span>💡 Chạm mặt kính để trả lời</span>
            <span>•</span>
            <span>Bấm nút ⌂ (Home) bên sườn để mở danh sách bài học</span>
            <span>•</span>
            <span>Bật mic hoặc gõ để đàm thoại</span>
          </div>
        </div>
      )}

      <DevDrawer open={devOpen} onClose={() => setDevOpen(false)} />
      <QrPairingModal />
      <QaAcceptanceModal isOpen={qaModalOpen} onClose={() => setQaModalOpen(false)} />
    </main>
  );
}

function Header({
  devOpen,
  onToggleDev,
  onOpenLogin,
  onOpenQa,
}: {
  devOpen: boolean;
  onToggleDev: () => void;
  onOpenLogin: () => void;
  onOpenQa: () => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const loginModalOpen = useSimulatorStore((state) => state.loginModalOpen);
  const showLessonPanel = useSimulatorStore((state) => state.showLessonPanel);
  const toggleLessonPanel = useSimulatorStore((state) => state.toggleLessonPanel);

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
        {/* Sổ Tay Nghiệm Thu & Test V3 */}
        <button
          type="button"
          onClick={onOpenQa}
          className="flex items-center gap-1.5 rounded-blob px-3.5 py-1.5 text-xs font-black transition shadow-sm bg-gradient-to-r from-amber-500 via-orange-500 to-coral-500 text-white hover:from-amber-600 hover:to-coral-600 active:scale-95 shadow-[0_4px_12px_-4px_rgba(245,158,11,0.6)]"
          title="Mở Sổ tay tài liệu nghiệm thu & Hướng dẫn test V3"
        >
          <span>📋</span>
          <span>Tài Liệu Nghiệm Thu V3</span>
          <span className="rounded-full bg-white/30 px-1.5 py-0.2 text-[10px] uppercase font-bold tracking-wider">
            HOT
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenLogin}
          className={`flex items-center gap-1.5 rounded-blob px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
            account
              ? 'bg-mint-400/15 text-mint-700 hover:bg-mint-400/25 border border-mint-400/30'
              : 'bg-coral-500 text-white shadow-[0_4px_12px_-4px_rgba(255,107,74,0.7)] hover:bg-coral-600 active:scale-95'
          }`}
          title="Kết nối thiết bị & Quản lý gán bé"
        >
          <span>{account ? '👶' : '📱'}</span>
          <span>
            {account
              ? account.child?.name
                ? `Bé ${account.child.name}`
                : account.name || 'Đã liên kết'
              : 'Mã QR & Đăng nhập'}
          </span>
        </button>

        {/* Toggle option for Technical Inspector */}
        <button
          type="button"
          onClick={toggleLessonPanel}
          className={`flex items-center gap-1.5 rounded-blob px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
            showLessonPanel
              ? 'bg-ink-700 text-white shadow-sm'
              : 'bg-cream-200/90 text-ink-600 hover:bg-cream-300 border border-cream-300'
          }`}
          title="Bật/tắt bảng kỹ thuật (debug inspector)"
        >
          <span>{showLessonPanel ? '✕ Ẩn kỹ thuật' : '🛠️ Debug'}</span>
        </button>

        <StatusPill />
        {/* A toggle, not an opener. The drawer no longer covers this button,
            so pressing it with the panel already open has to do something. */}
        <button
          type="button"
          onClick={onToggleDev}
          aria-expanded={devOpen}
          className={`rounded-blob px-4 py-2 text-sm font-bold shadow-[0_6px_16px_-10px_rgba(61,44,36,0.6)] transition active:scale-95 ${
            devOpen ? 'bg-ink-700 text-cream-100 hover:bg-ink-900' : 'bg-white text-ink-700 hover:bg-cream-100'
          }`}
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
