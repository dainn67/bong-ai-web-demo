import { useEffect, useState } from 'react';
import { useSimulatorStore } from '../../store/simulator-store';
import { PlaybackBar } from './playback-bar';
import { ActiveIndexCard } from './active-index-card';
import { IndexTable } from './index-table';

export function LessonStudioPanel() {
  const catalog = useSimulatorStore((state) => state.catalog);
  const catalogLoading = useSimulatorStore((state) => state.catalogLoading);
  const selectedLesson = useSimulatorStore((state) => state.selectedLesson);
  const lessonSourceMode = useSimulatorStore((state) => state.lessonSourceMode);
  const setLessonSourceMode = useSimulatorStore((state) => state.setLessonSourceMode);
  const loadCdnCatalog = useSimulatorStore((state) => state.loadCdnCatalog);
  const selectLesson = useSimulatorStore((state) => state.selectLesson);

  const [lessonFilter, setLessonFilter] = useState('');

  // Auto-fetch CDN catalog if empty
  useEffect(() => {
    if (catalog.length === 0) {
      void loadCdnCatalog();
    }
  }, [catalog.length, loadCdnCatalog]);

  const filteredCatalog = catalog.filter((it) => {
    if (!lessonFilter.trim()) return true;
    const q = lessonFilter.toLowerCase();
    return it.title.toLowerCase().includes(q) || it.id.toLowerCase().includes(q);
  });

  const handleSelectLesson = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const item = catalog.find((c) => c.id === id);
    if (item) {
      void selectLesson(item);
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Studio Header: Lesson Picker & Mode Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm border border-cream-300">
        <div className="flex flex-col gap-1.5 min-w-[280px] flex-1">
          <div className="flex items-center justify-between">
            <label htmlFor="lesson-picker" className="text-xs font-bold uppercase tracking-wider text-ink-500">
              Chọn Bài học kiểm thử:
            </label>
            {catalogLoading && (
              <span className="text-[10px] font-semibold text-sunny-600 animate-pulse">
                Đang tải danh sách bài…
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Tìm bài..."
              value={lessonFilter}
              onChange={(e) => setLessonFilter(e.target.value)}
              className="w-28 rounded-xl bg-cream-100 px-2.5 py-2 text-xs font-medium text-ink-900 border border-cream-300 placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-mint-500"
            />

            <select
              id="lesson-picker"
              value={selectedLesson?.id || ''}
              onChange={handleSelectLesson}
              className="flex-1 rounded-xl bg-cream-100 px-3 py-2 text-xs font-bold text-ink-900 border border-cream-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-mint-500"
            >
              <option value="" disabled>
                -- Chọn bài học / truyện --
              </option>
              {filteredCatalog.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.category === 'learning' ? '📚' : it.category === 'stories' ? '📖' : '💬'}{' '}
                  {it.title} ({it.category})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void loadCdnCatalog()}
              title="Tải lại danh mục từ CDN"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-cream-100 text-sm font-bold text-ink-700 hover:bg-cream-200 active:scale-95 transition"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Source Mode Toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
            Nguồn phát:
          </span>
          <div className="flex items-center rounded-xl bg-cream-100 p-1 border border-cream-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setLessonSourceMode('socket')}
              className={`rounded-lg px-3 py-1 transition flex items-center gap-1.5 ${
                lessonSourceMode === 'socket'
                  ? 'bg-mint-500 text-white shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
              title="Phát qua kết nối WebSocket xiaozhi-esp32-server (Mặc định & Ưu tiên)"
            >
              <span>🔌 WebSocket (ESP32)</span>
              <span className="rounded bg-white/20 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider">
                Ưu tiên
              </span>
            </button>
            <button
              type="button"
              onClick={() => setLessonSourceMode('direct')}
              className={`rounded-lg px-3 py-1 transition ${
                lessonSourceMode === 'direct'
                  ? 'bg-mint-500 text-white shadow-sm'
                  : 'text-ink-600 hover:text-ink-900'
              }`}
              title="Tải trực tiếp qua CDN/API gốc — Không cần esp32-server"
            >
              🚀 Direct (CDN)
            </button>
          </div>
        </div>
      </div>

      {/* Playback Controls Bar */}
      <PlaybackBar />

      {/* Active Index Inspector Card */}
      <ActiveIndexCard />

      {/* Index Table & Viewer */}
      <IndexTable />
    </div>
  );
}
