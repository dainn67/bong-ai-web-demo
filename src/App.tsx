import { useState, useEffect } from 'react';
import { RoundScreen } from './screen/round-screen';
import { BongBubble } from './screen/speech-bubble';
import { TalkBar } from './dev/talk-bar';
import { DevDrawer } from './dev/dev-drawer';
import { QrPairingModal } from './dev/qr-pairing-modal';
import { LessonStudioPanel } from './dev/lesson-studio/lesson-studio-panel';
import { ScriptEnginePanel } from './v3/script-engine-panel';
import { useSimulatorStore } from './store/simulator-store';
import { fetchProfile, hasStoredSession, type Account } from './api/auth-client';

/**
 * The badge, centre stage or studio mode.
 *
 * When studio mode is active on wide screens, presents a 2-column studio layout:
 * Left column displays the physical round screen, right column displays the
 * lesson selector, index table, active inspector and playback controls.
 */
export default function App() {
  const [devOpen, setDevOpen] = useState(false);
  const showLessonPanel = useSimulatorStore((state) => state.showLessonPanel);
  const setShowLessonPanel = useSimulatorStore((state) => state.setShowLessonPanel);
  const lessonEngineType = useSimulatorStore((state) => state.lessonEngineType);
  const setLessonEngineType = useSimulatorStore((state) => state.setLessonEngineType);
  const setLoginOpen = useSimulatorStore((state) => state.setLoginModalOpen);

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
              <div className="flex items-center gap-1 p-1 bg-cream-200/80 rounded-xl text-xs font-bold border border-cream-300">
                <button
                  type="button"
                  onClick={() => setLessonEngineType('v2')}
                  className={`rounded-lg px-3 py-1 transition ${
                    lessonEngineType === 'v2'
                      ? 'bg-mint-500 text-white shadow-sm'
                      : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  📚 Kịch bản bài học (FSM)
                </button>
                <button
                  type="button"
                  onClick={() => setLessonEngineType('v3')}
                  className={`rounded-lg px-3 py-1 transition ${
                    lessonEngineType === 'v3'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  ⚡ Script Engine v3 (Offline)
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowLessonPanel(false)}
                className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800 font-bold px-2.5 py-1 rounded-lg hover:bg-cream-200 transition"
                title="Ẩn bảng kiểm thử bài học"
              >
                ✕ Ẩn bảng
              </button>
            </div>

            {lessonEngineType === 'v2' ? <LessonStudioPanel /> : <ScriptEnginePanel />}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-12">
          <RoundScreen />
          <BongBubble />
          <TalkBar />
          <button
            type="button"
            onClick={() => setShowLessonPanel(true)}
            className="flex items-center gap-2 rounded-full bg-cream-200/90 hover:bg-cream-300 text-ink-700 px-4 py-2 text-xs font-bold transition shadow-sm border border-cream-300 active:scale-95"
            title="Mở bảng kiểm thử bài học bên cạnh thiết bị"
          >
            <span>🎛</span>
            <span>Mở bảng kiểm thử bài học</span>
          </button>
        </div>
      )}

      <DevDrawer open={devOpen} onClose={() => setDevOpen(false)} />
      <QrPairingModal />
    </main>
  );
}

function Header({
  devOpen,
  onToggleDev,
  onOpenLogin,
}: {
  devOpen: boolean;
  onToggleDev: () => void;
  onOpenLogin: () => void;
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

        {/* Toggle option for Lesson Testing */}
        <button
          type="button"
          onClick={toggleLessonPanel}
          className={`flex items-center gap-1.5 rounded-blob px-3.5 py-1.5 text-xs font-bold transition shadow-sm ${
            showLessonPanel
              ? 'bg-mint-500 text-white shadow-[0_4px_12px_-4px_rgba(46,189,133,0.7)] hover:bg-mint-600'
              : 'bg-cream-200/90 text-ink-700 hover:bg-cream-300 border border-cream-300'
          }`}
          title="Bật/tắt kiểm thử bài học bên cạnh thiết bị"
        >
          <span>{showLessonPanel ? '📖' : '📚'}</span>
          <span>{showLessonPanel ? 'Ẩn kiểm thử' : 'Hiện kiểm thử bài học'}</span>
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
