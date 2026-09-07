import { cdnUrl } from '../../lessons/catalog';
import { useSimulatorStore } from '../../store/simulator-store';

export function ActiveIndexCard() {
  const activeIndex = useSimulatorStore((state) => state.directActiveIndex);
  const indexes = useSimulatorStore((state) => state.directIndexes);
  const playbackState = useSimulatorStore((state) => state.directPlaybackState);
  const playStudioIndex = useSimulatorStore((state) => state.playStudioIndex);
  const dispatchTouch = useSimulatorStore((state) => state.dispatchTouch);

  if (!activeIndex) {
    return (
      <div className="rounded-2xl border border-dashed border-cream-300 bg-cream-100/50 p-4 text-center">
        <p className="text-xs font-semibold text-ink-500">
          Chưa chọn index nào — Bấm vào một dòng bên dưới hoặc bấm nút Play để bắt đầu
        </p>
      </div>
    );
  }

  const primaryAudio = activeIndex.audios[0];
  const primaryVisual = activeIndex.visuals[0];
  const visualUrl = primaryVisual ? cdnUrl(primaryVisual.url) : null;
  const audioUrl = primaryAudio ? cdnUrl(primaryAudio.url) : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm border border-cream-300">
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-cream-200 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-mint-500 text-xs font-bold text-white shadow-sm">
            #{activeIndex.order}
          </span>
          <div>
            <h4 className="text-sm font-bold text-ink-900 leading-none">
              Index {activeIndex.order}{' '}
              <span className="text-xs font-normal text-ink-400">
                / {indexes.length} nodes
              </span>
            </h4>
            <p className="text-[11px] font-medium text-ink-500 mt-0.5">
              {activeIndex.type ? `Loại: ${activeIndex.type}` : 'Node bài học'}{' '}
              {activeIndex.next ? `· Tiếp theo: #${activeIndex.next}` : '· Kết thúc'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              playbackState === 'playing'
                ? 'bg-mint-100 text-mint-700 animate-pulse'
                : playbackState === 'paused'
                ? 'bg-sunny-100 text-ink-800'
                : 'bg-cream-200 text-ink-600'
            }`}
          >
            {playbackState === 'playing'
              ? 'Đang phát'
              : playbackState === 'paused'
              ? 'Tạm dừng'
              : 'Đã xong'}
          </span>
          <button
            type="button"
            onClick={() => void playStudioIndex(activeIndex.order)}
            title="Phát lại index này"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-cream-100 text-xs font-bold text-ink-700 hover:bg-cream-200"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Main Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Visual Info */}
        <div className="flex items-start gap-2.5 rounded-xl bg-cream-100 p-2.5 border border-cream-200">
          {visualUrl ? (
            <div className="relative group shrink-0">
              <img
                src={visualUrl}
                alt={`Visual ${activeIndex.order}`}
                className="h-14 w-14 rounded-lg object-cover border border-cream-300 shadow-sm bg-white"
              />
              <a
                href={visualUrl}
                target="_blank"
                rel="noreferrer"
                title="Mở ảnh gốc trong tab mới"
                className="absolute inset-0 flex items-center justify-center rounded-lg bg-ink-900/60 opacity-0 group-hover:opacity-100 text-white text-[10px] font-bold transition"
              >
                Xem ↗
              </a>
            </div>
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-cream-200 text-xs font-bold shadow-inner">
              Tối đen
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink-800">Hình ảnh:</span>
              {primaryVisual?.stop && (
                <span
                  className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase ${
                    primaryVisual.stop === 'giu'
                      ? 'bg-mint-100 text-mint-700'
                      : 'bg-coral-100 text-coral-700'
                  }`}
                >
                  Stop: {primaryVisual.stop}
                </span>
              )}
            </div>
            <p className="truncate text-xs font-mono text-ink-600 mt-0.5" title={primaryVisual?.fileName || 'Không có ảnh'}>
              {primaryVisual?.fileName || 'visual: [] (màn hình đen)'}
            </p>
            {visualUrl && (
              <p className="truncate text-[10px] text-ink-400 mt-0.5">
                {visualUrl.split('/').pop()}
              </p>
            )}
          </div>
        </div>

        {/* Audio Info */}
        <div className="flex items-start gap-2.5 rounded-xl bg-cream-100 p-2.5 border border-cream-200">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-sunny-400/20 text-xl border border-sunny-300 shadow-sm">
            🔊
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-ink-800">Âm thanh:</span>
              {primaryAudio?.nodeType && (
                <span className="rounded bg-cream-200 px-1.5 py-0.2 text-[9px] font-bold uppercase text-ink-600">
                  {primaryAudio.nodeType}
                </span>
              )}
            </div>
            <p className="truncate text-xs font-mono text-ink-600 mt-0.5" title={primaryAudio?.fileName || 'Không có âm thanh'}>
              {primaryAudio?.fileName || 'Không có file audio'}
            </p>
            {audioUrl && (
              <a
                href={audioUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-mint-600 hover:underline inline-block mt-0.5 truncate max-w-full"
              >
                {audioUrl.split('/').pop()} ↗
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Question / Touch Branching Interaction */}
      {activeIndex.question && (
        <div className="rounded-xl bg-sunny-400/15 p-2.5 border border-sunny-400/30">
          <p className="text-xs font-bold text-ink-800 flex items-center gap-1.5">
            <span>❓ Câu hỏi tương tác:</span>
            <span className="font-normal text-ink-600">
              {activeIndex.question.type || 'câu hỏi'}
            </span>
          </p>

          {/* Quick simulated answer buttons */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => dispatchTouch('zone1')}
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-sm hover:bg-cream-200 active:scale-95 transition"
            >
              👈 Chạm Vùng 1 (zone1)
            </button>
            <button
              type="button"
              onClick={() => dispatchTouch('zone2')}
              className="rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-ink-800 shadow-sm hover:bg-cream-200 active:scale-95 transition"
            >
              👉 Chạm Vùng 2 (zone2)
            </button>
            <button
              type="button"
              onClick={() => dispatchTouch('cham_khac')}
              className="rounded-lg bg-cream-200 px-2.5 py-1 text-xs font-semibold text-ink-600 hover:bg-cream-300 active:scale-95 transition"
            >
              Chạm khác / Im lặng
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
