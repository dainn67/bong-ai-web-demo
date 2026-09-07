import { useState } from 'react';
import { useSimulatorStore } from '../../store/simulator-store';

export function PlaybackBar() {
  const directPlaybackState = useSimulatorStore((state) => state.directPlaybackState);
  const directAutoNext = useSimulatorStore((state) => state.directAutoNext);
  const directAutoNextDelayMs = useSimulatorStore((state) => state.directAutoNextDelayMs);
  const directActiveIndex = useSimulatorStore((state) => state.directActiveIndex);
  const directIndexes = useSimulatorStore((state) => state.directIndexes);

  const playStudioIndex = useSimulatorStore((state) => state.playStudioIndex);
  const playStudioNext = useSimulatorStore((state) => state.playStudioNext);
  const playStudioPrev = useSimulatorStore((state) => state.playStudioPrev);
  const toggleStudioPause = useSimulatorStore((state) => state.toggleStudioPause);
  const stopStudioLesson = useSimulatorStore((state) => state.stopStudioLesson);
  const toggleDirectAutoNext = useSimulatorStore((state) => state.toggleDirectAutoNext);
  const setDirectAutoNextDelay = useSimulatorStore((state) => state.setDirectAutoNextDelay);

  const [jumpOrder, setJumpOrder] = useState('');

  const isPlaying = directPlaybackState === 'playing';
  const hasIndexes = directIndexes.length > 0;

  const handlePlayPause = () => {
    if (directActiveIndex) {
      toggleStudioPause();
    } else if (hasIndexes) {
      void playStudioIndex(directIndexes[0].order);
    }
  };

  const handleNext = () => {
    void playStudioNext();
  };

  const handlePrev = () => {
    void playStudioPrev();
  };

  const handleQuickJump = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = jumpOrder.trim();
    if (!trimmed) return;
    void playStudioIndex(trimmed);
    setJumpOrder('');
  };


  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3.5 shadow-sm border border-cream-300">
      {/* Playback Transport Buttons */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handlePrev}
          disabled={!directActiveIndex}
          title="Index trước đó"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-200 text-ink-700 hover:bg-cream-300 active:scale-95 disabled:opacity-40 transition"
        >
          ⏮
        </button>

        <button
          type="button"
          onClick={handlePlayPause}
          disabled={!hasIndexes}
          title={isPlaying ? 'Tạm dừng' : 'Phát'}
          className={`flex h-10 w-12 items-center justify-center rounded-xl text-lg font-bold shadow-sm transition active:scale-95 disabled:opacity-40 ${
            isPlaying
              ? 'bg-sunny-400 text-ink-900 hover:bg-sunny-500'
              : 'bg-mint-500 text-white hover:bg-mint-600 shadow-[0_4px_12px_-4px_rgba(46,189,133,0.6)]'
          }`}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        <button
          type="button"
          onClick={handleNext}
          disabled={!hasIndexes}
          title="Index kế tiếp"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-200 text-ink-700 hover:bg-cream-300 active:scale-95 disabled:opacity-40 transition"
        >
          ⏭
        </button>

        <button
          type="button"
          onClick={stopStudioLesson}
          disabled={!directActiveIndex && directPlaybackState === 'idle'}
          title="Dừng bài học"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-coral-500/10 text-coral-600 hover:bg-coral-500/20 active:scale-95 disabled:opacity-40 transition"
        >
          ⏹
        </button>
      </div>

      {/* Auto Next Controls */}
      <div className="flex items-center gap-2 rounded-xl bg-cream-100 px-3 py-1.5 border border-cream-200">
        <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-ink-800">
          <input
            type="checkbox"
            checked={directAutoNext}
            onChange={toggleDirectAutoNext}
            className="h-4 w-4 rounded accent-mint-500 cursor-pointer"
          />
          <span>🔁 Tự Next</span>
        </label>

        {directAutoNext && (
          <select
            value={directAutoNextDelayMs}
            onChange={(e) => setDirectAutoNextDelay(Number(e.target.value))}
            className="rounded-lg bg-white px-2 py-1 text-xs font-semibold text-ink-800 border border-cream-300 focus:outline-none focus:ring-1 focus:ring-mint-500"
          >
            <option value={0}>Ngay tức thì (0s)</option>
            <option value={1000}>Chờ 1 giây</option>
            <option value={1500}>Chờ 1.5 giây</option>
            <option value={2000}>Chờ 2 giây</option>
            <option value={3000}>Chờ 3 giây</option>
            <option value={5000}>Chờ 5 giây</option>
          </select>
        )}
      </div>

      {/* Quick Jump Input */}
      <form onSubmit={handleQuickJump} className="flex items-center gap-1.5">
        <div className="relative">
          <input
            type="text"
            placeholder="Số index (e.g. 57)"
            value={jumpOrder}
            onChange={(e) => setJumpOrder(e.target.value)}
            className="w-32 rounded-xl bg-cream-100 px-3 py-1.5 text-xs font-mono font-medium text-ink-900 border border-cream-300 placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mint-500"
          />
        </div>
        <button
          type="submit"
          disabled={!jumpOrder.trim()}
          className="rounded-xl bg-ink-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-ink-900 active:scale-95 disabled:opacity-40 transition shadow-sm"
        >
          Nhảy
        </button>
      </form>
    </div>
  );
}
