/**
 * The mode picker, drawn inside the circle.
 *
 * Laid out for a **round** screen, which is the thing that went wrong the first
 * time. The original put a back arrow and a close cross in the top corners of
 * an `inset-0` box — but at the top of a circle the chord is far narrower than
 * the box, so both were rendered outside the glass and clipped away by
 * `overflow-hidden`. They looked like they were missing because they were.
 *
 * So: no controls in the corners, everything on the centre line, and the
 * content column inset far enough to stay inside the circle at the top and
 * bottom rows. Navigation is on the rim buttons, where a round device puts it.
 */

import { useSimulatorStore } from '../store/simulator-store';
import { MODE_LABELS, MODE_ORDER, rowsFor } from './menu-state';
import type { LessonSummary } from '../lessons/catalog';

export function ScreenMenu() {
  const menu = useSimulatorStore((state) => state.menu);
  const catalog = useSimulatorStore((state) => state.catalog);
  const loading = useSimulatorStore((state) => state.catalogLoading);
  const error = useSimulatorStore((state) => state.catalogError);
  const chooseMode = useSimulatorStore((state) => state.chooseMode);
  const startEntry = useSimulatorStore((state) => state.startEntry);

  const view = menu.view;
  if (view.screen === 'closed') return null;

  const isRoot = view.screen === 'root';
  const rows = rowsFor(menu, catalog);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-screen/95 backdrop-blur-sm">
      <p className="pb-2 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-cream-200/50">
        {view.screen === 'picker'
          ? view.category === 'stories'
            ? 'Truyện'
            : 'Bài học'
          : 'Chọn chế độ'}
      </p>

      {/*
        Two constraints at once. The width is capped at 60% so the top and
        bottom rows still fall inside the circle's chord, and the height at 44%
        so the list stays in the middle band where the circle is widest. Wider
        or taller and rows get sliced by the curve — which is what the first
        attempt did, leaving a half-drawn row hanging over the footer.

        Three rows fit; anything longer scrolls.
      */}
      <div className="flex max-h-[44%] w-[60%] flex-col gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {/* The way out, said once. A child who opens this needs to know the way
          back is a button on the side, not something on the glass. */}
      <p className="pt-2.5 text-center text-[9px] font-medium text-cream-200/30">
        Bấm nút ⌂ để quay lại
      </p>
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

/**
 * One row.
 *
 * Centred, and the icon sits above the title rather than beside it. Inline
 * would left-align the text block against a curved edge, and on a round screen
 * that reads as crooked even when it is not.
 */
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
      className="w-full shrink-0 rounded-2xl bg-cream-200/10 px-2 py-1.5 text-center transition active:scale-[0.97] active:bg-cream-200/20"
    >
      <span className="flex items-center justify-center gap-1.5">
        <span className="text-sm leading-none">{icon}</span>
        <span className="truncate text-[13px] font-bold text-cream-100">{title}</span>
      </span>
      {hint && (
        <span className="mt-0.5 block truncate text-[9px] leading-tight text-cream-200/45">
          {hint}
        </span>
      )}
    </button>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-2 py-6 text-center text-xs font-medium text-cream-200/60">{text}</p>;
}
