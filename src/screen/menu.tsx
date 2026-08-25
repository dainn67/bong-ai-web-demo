/**
 * The mode picker, drawn inside the circle.
 *
 * Laid out for a **round** screen, which is the thing that went wrong the first
 * time. The original put a back arrow and a close cross in the top corners of
 * an `inset-0` box — but at the top of a circle the chord is far narrower than
 * the box, so both were rendered outside the glass and clipped away by
 * `overflow-hidden`. They looked like they were missing because they were.
 *
 * So: no controls in the corners, everything centred, and the content sized to
 * the inscribed square — the largest rectangle a circle can hold. Navigation is
 * on the rim buttons, where a round device puts it.
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
    <div className="absolute inset-0 flex items-center justify-center bg-screen/95 backdrop-blur-sm">
      {/*
        The largest rectangle that fits in a circle is the inscribed square —
        side = diameter / √2, about 71%. That is the budget, and the layout
        should spend all of it: an earlier version used 60% × 44% out of caution
        and left the menu floating as a small box in a large dark circle.

        72% overshoots the inscribed square by a whisker, which the rows'
        rounded corners absorb — a `rounded-2xl` corner is pulled further inside
        than the square corner it replaces.
      */}
      <div className="flex h-[72%] w-[72%] flex-col">
        <p className="shrink-0 pb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-cream-200/50">
          {view.screen === 'picker'
            ? view.category === 'stories'
              ? 'Truyện'
              : 'Bài học'
            : 'Chọn chế độ'}
        </p>

        {/*
          The fade is not decoration. A scroll list ending at a hard edge chops
          the next row through the middle of its text, which reads as a layout
          bug rather than as "there is more below" — and here it landed right on
          top of the footer. Fading the last few percent says the same thing
          without the broken-looking seam.
        */}
        <div
          style={{
            maskImage: 'linear-gradient(to bottom, #000 88%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, #000 88%, transparent 100%)',
          }}
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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
        <p className="shrink-0 pt-1.5 text-center text-[9px] font-medium text-cream-200/30">
          Bấm nút ⌂ để quay lại
        </p>
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
      className="w-full shrink-0 rounded-2xl bg-cream-200/10 px-2.5 py-2 text-center transition active:scale-[0.97] active:bg-cream-200/20"
    >
      <span className="flex items-center justify-center gap-1.5">
        <span className="text-base leading-none">{icon}</span>
        <span className="truncate text-sm font-bold text-cream-100">{title}</span>
      </span>
      {hint && (
        <span className="mt-0.5 block truncate text-[10px] leading-tight text-cream-200/45">
          {hint}
        </span>
      )}
    </button>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-2 py-6 text-center text-xs font-medium text-cream-200/60">{text}</p>;
}
