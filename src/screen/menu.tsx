/**
 * The mode picker, drawn inside the circle.
 *
 * Everything here obeys the display: rows are big enough for a small finger,
 * the list scrolls rather than shrinking to fit, and nothing sits in the
 * corners a round screen does not have.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { MODE_LABELS, MODE_ORDER, rowsFor } from './menu-state';
import type { LessonSummary } from '../lessons/catalog';

export function ScreenMenu() {
  const menu = useSimulatorStore((state) => state.menu);
  const catalog = useSimulatorStore((state) => state.catalog);
  const loading = useSimulatorStore((state) => state.catalogLoading);
  const error = useSimulatorStore((state) => state.catalogError);
  const dispatch = useSimulatorStore((state) => state.menuDispatch);
  const chooseMode = useSimulatorStore((state) => state.chooseMode);
  const startEntry = useSimulatorStore((state) => state.startEntry);

  const view = menu.view;
  if (view.screen === 'closed') return null;

  const isRoot = view.screen === 'root';
  const rows = rowsFor(menu, catalog);

  return (
    <div className="absolute inset-0 flex flex-col bg-screen/95 px-7 py-6 backdrop-blur-sm">
      <header className="flex items-center justify-between px-1 pb-2">
        <button
          type="button"
          onClick={() => dispatch({ type: 'back' })}
          className="text-lg leading-none text-cream-200/70 transition active:scale-90"
          aria-label="Quay lại"
        >
          ←
        </button>
        <p className="text-[11px] font-bold uppercase tracking-wider text-cream-200/60">
          {view.screen === 'picker'
            ? view.category === 'stories'
              ? 'Truyện'
              : 'Bài học'
            : 'Chọn chế độ'}
        </p>
        <button
          type="button"
          onClick={() => dispatch({ type: 'close' })}
          className="text-lg leading-none text-cream-200/70 transition active:scale-90"
          aria-label="Đóng"
        >
          ✕
        </button>
      </header>

      {/* The scroll area is inset from the circle's edge so the first and last
          rows are not clipped by the curve. */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isRoot
          ? MODE_ORDER.map((mode) => (
              <Row
                key={mode}
                icon={MODE_LABELS[mode].icon}
                title={MODE_LABELS[mode].title}
                hint={MODE_LABELS[mode].hint}
                onSelect={() => chooseMode(mode)}
              />
            ))
          : renderList({ rows, loading, error, onSelect: startEntry })}
      </div>
    </div>
  );
}

function renderList({
  rows,
  loading,
  error,
  onSelect,
}: {
  rows: LessonSummary[];
  loading: boolean;
  error: string | null;
  onSelect: (entry: LessonSummary) => void;
}) {
  if (loading) return <Notice text="Đang tải…" />;
  if (error) return <Notice text={error} />;
  if (rows.length === 0) return <Notice text="Chưa có nội dung nào" />;

  return rows.map((entry) => (
    <Row
      key={entry.id}
      icon={entry.category === 'stories' ? '📖' : '✏️'}
      title={entry.title}
      hint={entry.description}
      onSelect={() => onSelect(entry)}
    />
  ));
}

function Row({
  icon,
  title,
  hint,
  onSelect,
}: {
  icon: string;
  title: string;
  hint: string | null;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-2xl bg-cream-200/10 px-3 py-2.5 text-left transition active:scale-[0.97] active:bg-cream-200/20"
    >
      <span className="shrink-0 text-lg leading-none">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-cream-100">{title}</span>
        {hint && (
          <span className="block truncate text-[10px] leading-tight text-cream-200/50">{hint}</span>
        )}
      </span>
    </button>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="px-2 py-6 text-center text-xs font-medium text-cream-200/60">{text}</p>
  );
}
