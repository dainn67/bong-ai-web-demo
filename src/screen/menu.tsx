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
import { MODE_LABELS, MODE_ORDER } from './menu-state';

export function ScreenMenu() {
  const menu = useSimulatorStore((state) => state.menu);
  const chooseMode = useSimulatorStore((state) => state.chooseMode);

  if (menu.view.screen === 'closed') return null;

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
          Chọn chế độ
        </p>

        {/*
          Three rows fit without scrolling now that the catalog screen is gone,
          but the fade stays: it costs nothing and it is what stops a fourth
          mode, whenever one arrives, from being chopped through its text.
        */}
        <div
          style={{
            maskImage: 'linear-gradient(to bottom, #000 88%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, #000 88%, transparent 100%)',
          }}
          className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {MODE_ORDER.map((mode) => (
            <Row
              key={mode}
              icon={MODE_LABELS[mode].icon}
              title={MODE_LABELS[mode].title}
              hint={MODE_LABELS[mode].hint}
              onSelect={() => chooseMode(mode)}
            />
          ))}
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
