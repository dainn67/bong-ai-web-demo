import { useEffect, useRef, useState } from 'react';
import { cdnUrl } from '../../lessons/catalog';
import { useSimulatorStore } from '../../store/simulator-store';
import { isEafUrl, EafThumbnail } from '../../screen/eaf-view';

export function IndexTable() {
  const indexes = useSimulatorStore((state) => state.directIndexes);
  const activeIndex = useSimulatorStore((state) => state.directActiveIndex);
  const playbackState = useSimulatorStore((state) => state.directPlaybackState);
  const playStudioIndex = useSimulatorStore((state) => state.playStudioIndex);

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'with-image' | 'question'>('all');

  const activeRowRef = useRef<HTMLTableRowElement | null>(null);

  // Auto-scroll active row into view when activeIndex changes
  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeIndex?.order]);

  const filteredIndexes = indexes.filter((item) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchOrder = item.order.toLowerCase().includes(q);
      const matchAudio = item.audios.some((a) => a.fileName?.toLowerCase().includes(q));
      const matchVisual = item.visuals.some((v) => v.fileName?.toLowerCase().includes(q));
      if (!matchOrder && !matchAudio && !matchVisual) return false;
    }

    if (filterType === 'with-image') {
      return item.visuals.length > 0 && Boolean(item.visuals[0].url);
    }
    if (filterType === 'question') {
      return Boolean(item.question);
    }
    return true;
  });

  if (indexes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl bg-white border border-cream-300">
        <p className="text-sm font-bold text-ink-700">Chưa có dữ liệu Index</p>
        <p className="text-xs text-ink-400 mt-1">
          Chọn một bài học từ danh sách phía trên để tải danh sách các index
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-2xl bg-white shadow-sm border border-cream-300 overflow-hidden">
      {/* Search & Filter Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-cream-200 bg-cream-50/70 p-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-bold text-ink-800">
            Danh sách Index ({filteredIndexes.length}/{indexes.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Filter Pills */}
          <div className="flex items-center rounded-lg bg-cream-200/70 p-0.5 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`rounded-md px-2 py-0.5 transition ${
                filterType === 'all'
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              Tất cả
            </button>
            <button
              type="button"
              onClick={() => setFilterType('with-image')}
              className={`rounded-md px-2 py-0.5 transition ${
                filterType === 'with-image'
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              Có ảnh
            </button>
            <button
              type="button"
              onClick={() => setFilterType('question')}
              className={`rounded-md px-2 py-0.5 transition ${
                filterType === 'question'
                  ? 'bg-white text-ink-900 shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
            >
              Câu hỏi
            </button>
          </div>

          {/* Search Input */}
          <input
            type="text"
            placeholder="Lọc số order, tên file..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-40 rounded-lg bg-white px-2.5 py-1 text-xs font-medium text-ink-900 border border-cream-300 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-mint-500"
          />
        </div>
      </div>

      {/* Table Content */}
      <div className="flex-1 overflow-y-auto max-h-[460px] divide-y divide-cream-100">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-cream-100 text-[10px] font-bold uppercase tracking-wider text-ink-500 z-10">
            <tr>
              <th className="py-2 px-3 w-14 text-center">#</th>
              <th className="py-2 px-2 w-14 text-center">Visual</th>
              <th className="py-2 px-3">Nội dung Audio / Visual</th>
              <th className="py-2 px-2 w-16 text-center">Tiếp</th>
              <th className="py-2 px-3 w-20 text-right">Phát</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-cream-100">
            {filteredIndexes.map((item) => {
              const isActive = activeIndex?.order === item.order;
              const primaryVis = item.visuals[0];
              const primaryAud = item.audios[0];
              const visUrl = primaryVis ? cdnUrl(primaryVis.url) : null;

              return (
                <tr
                  key={item.order}
                  ref={isActive ? activeRowRef : undefined}
                  className={`group transition-colors ${
                    isActive
                      ? 'bg-mint-50/80 font-medium'
                      : 'hover:bg-cream-50/80'
                  }`}
                >
                  {/* Order Column */}
                  <td className="py-2 px-3 text-center">
                    <span
                      className={`inline-flex h-6 w-8 items-center justify-center rounded-md font-mono text-[11px] font-bold ${
                        isActive
                          ? 'bg-mint-500 text-white shadow-sm'
                          : 'bg-cream-200 text-ink-700 group-hover:bg-cream-300'
                      }`}
                    >
                      {item.order}
                    </span>
                  </td>

                  {/* Visual Thumbnail */}
                  <td className="py-2 px-2 text-center">
                    {visUrl ? (
                      isEafUrl(visUrl) || isEafUrl(primaryVis?.fileName) ? (
                        <EafThumbnail
                          url={visUrl}
                          fileName={primaryVis?.fileName}
                          size="sm"
                        />
                      ) : (
                        <img
                          src={visUrl}
                          alt=""
                          loading="lazy"
                          className="h-9 w-9 rounded-md object-cover border border-cream-200 shadow-xs inline-block bg-white"
                        />
                      )
                    ) : (
                      <span
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink-900/10 text-[9px] font-bold text-ink-400"
                        title="Không có visual (màn hình đen)"
                      >
                        Đen
                      </span>
                    )}
                  </td>

                  {/* Audio & Visual Description */}
                  <td className="py-2 px-3">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {primaryAud?.fileName && (
                          <span className="font-mono text-ink-800 text-xs font-semibold">
                            {primaryAud.fileName}
                          </span>
                        )}
                        {primaryAud?.nodeType && (
                          <span className="rounded bg-cream-200 px-1.5 py-0.2 text-[9px] uppercase font-bold text-ink-600">
                            {primaryAud.nodeType}
                          </span>
                        )}
                        {primaryVis?.stop && (
                          <span
                            className={`rounded px-1.5 py-0.2 text-[9px] uppercase font-bold ${
                              primaryVis.stop === 'giu'
                                ? 'bg-mint-100 text-mint-700'
                                : 'bg-coral-100 text-coral-700'
                            }`}
                          >
                            {primaryVis.stop}
                          </span>
                        )}
                        {item.question && (
                          <span className="rounded bg-sunny-200 px-1.5 py-0.2 text-[9px] font-bold text-ink-800">
                            ❓ question
                          </span>
                        )}
                      </div>

                      {primaryVis?.fileName && (
                        <p className="text-[10px] text-ink-400 truncate max-w-xs font-mono">
                          visual: {primaryVis.fileName}
                        </p>
                      )}
                    </div>
                  </td>

                  {/* Next Target */}
                  <td className="py-2 px-2 text-center font-mono text-[11px] text-ink-500">
                    {item.next ? `→ ${item.next}` : '•'}
                  </td>

                  {/* Play Button */}
                  <td className="py-2 px-3 text-right">
                    <button
                      type="button"
                      onClick={() => void playStudioIndex(item.order)}
                      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition active:scale-95 shadow-xs ${
                        isActive
                          ? playbackState === 'playing'
                            ? 'bg-sunny-400 text-ink-900 hover:bg-sunny-500'
                            : 'bg-mint-500 text-white hover:bg-mint-600'
                          : 'bg-cream-200 text-ink-800 hover:bg-mint-500 hover:text-white'
                      }`}
                    >
                      {isActive && playbackState === 'playing' ? '⏸' : '▶'} Phát
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
