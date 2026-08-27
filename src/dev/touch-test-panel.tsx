/**
 * A stand-in `câu hỏi chạm` for each of the seven layouts.
 *
 * There is no way to check zone numbering against artwork by reading code: the
 * illustration has to line up with the grid, and the only way to know it does
 * is to press it. So this panel fakes the one thing a real lesson would supply
 * — a picture drawn to a layout, and a branch per zone — and then shows which
 * branch the press resolved to.
 *
 * The fake branches live here rather than in `ActivityView` on purpose. On the
 * device the script decides what a zone means; a view that had opinions about
 * that would fight the engine over the same screen, and win two seconds later.
 */

import { useEffect, useRef } from 'react';
import { Panel } from './dev-drawer';
import { useSimulatorStore } from '../store/simulator-store';
import { TOUCH_LAYOUTS, type TouchLayoutType } from '../screen/touch-layout';

interface LayoutDemo {
  name: string;
  /** The illustration drawn to this layout's grid. */
  image: string;
  /** What Bống would be asking, so the zones have meaning. */
  caption: string;
  /** Emoji shorthand for the panel row, zone 1 first. */
  icon: string;
  /** What each `branchType` leads to, the way a script's `branches[]` would. */
  branches: Record<string, { image: string; notice: string }>;
}

/** How long a fake branch shows before the question comes back for another try. */
const BRANCH_DWELL_MS = 2_000;

const DEMOS: Record<TouchLayoutType, LayoutDemo> = {
  tap2_tren_duoi: {
    name: '2 vùng Trên / Dưới',
    image: '/demo-tap2-td.svg',
    caption: 'Bé thích Ban ngày (Mặt Trời ☀️) hay Ban đêm (Mặt Trăng 🌙)?',
    icon: '☀️ 🌙',
    branches: {
      zone1: { image: '/demo-sun.svg', notice: '☀️ zone1 — Mặt Trời (ban ngày)' },
      zone2: { image: '/demo-moon.svg', notice: '🌙 zone2 — Mặt Trăng (ban đêm)' },
    },
  },
  tap2_trai_phai: {
    name: '2 vùng Trái / Phải',
    image: '/demo-tap2-tp.svg',
    caption: 'Bé thích Táo đỏ 🍎 hay Chuối vàng 🍌?',
    icon: '🍎 🍌',
    branches: {
      zone1: { image: '/demo-apple.svg', notice: '🍎 zone1 — quả táo đỏ' },
      zone2: { image: '/demo-banana.svg', notice: '🍌 zone2 — quả chuối vàng' },
    },
  },
  tap3: {
    name: '3 vùng quạt',
    image: '/demo-tap3.svg',
    caption: 'Bé thích phương tiện nào nhất: Máy bay ✈️, Tàu thủy 🚢 hay Ô tô 🚗?',
    icon: '✈️ 🚢 🚗',
    branches: {
      zone1: { image: '/demo-plane.svg', notice: '✈️ zone1 — máy bay' },
      zone2: { image: '/demo-ship.svg', notice: '🚢 zone2 — tàu thủy' },
      zone3: { image: '/demo-car.svg', notice: '🚗 zone3 — ô tô' },
      cham_khac: {
        image: '/demo-deadzone-tap3.svg',
        notice: '⚠️ cham_khac — vùng chết ở tâm hoặc ngoài vòng tròn',
      },
    },
  },
  tap4: {
    name: '4 vùng quạt',
    image: '/demo-tap4.svg',
    caption: 'Bé yêu thích bạn nhỏ nào nhất: Mèo 🐱, Chó 🐶, Voi 🐘 hay Khỉ 🐒?',
    icon: '🐱 🐶 🐘 🐒',
    branches: {
      zone1: { image: '/demo-cat.svg', notice: '🐱 zone1 — bạn Mèo' },
      zone2: { image: '/demo-dog.svg', notice: '🐶 zone2 — bạn Chó' },
      zone3: { image: '/demo-elephant.svg', notice: '🐘 zone3 — bạn Voi' },
      zone4: { image: '/demo-monkey.svg', notice: '🐒 zone4 — bạn Khỉ' },
      cham_khac: {
        image: '/demo-deadzone-tap4.svg',
        notice: '⚠️ cham_khac — vùng chết ở tâm hoặc ngoài vòng tròn',
      },
    },
  },
  tap5: {
    name: '5 vùng quạt',
    image: '/demo-tap5.svg',
    caption: 'Bé chọn 1 trong 5 biểu tượng: Sao ⭐, Tim ❤️, Mây ☁️, Cầu vồng 🌈, Chớp ⚡',
    icon: '⭐ ❤️ ☁️ 🌈 ⚡',
    branches: {
      zone1: { image: '/demo-star.svg', notice: '⭐ zone1 — ngôi sao' },
      zone2: { image: '/demo-heart.svg', notice: '❤️ zone2 — trái tim' },
      zone3: { image: '/demo-cloud.svg', notice: '☁️ zone3 — đám mây' },
      zone4: { image: '/demo-rainbow.svg', notice: '🌈 zone4 — cầu vồng' },
      zone5: { image: '/demo-lightning.svg', notice: '⚡ zone5 — tia chớp' },
      cham_khac: {
        image: '/demo-deadzone-tap5.svg',
        notice: '⚠️ cham_khac — vùng chết ở tâm (r = 63px) hoặc ngoài vòng tròn',
      },
    },
  },
  tap6: {
    name: '6 vùng quạt',
    image: '/demo-tap6.svg',
    caption: 'Bé hãy chạm vào một con số từ 1️⃣ đến 6️⃣ nhé!',
    icon: '1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣',
    branches: {
      zone1: { image: '/demo-num1.svg', notice: '1️⃣ zone1 — số 1' },
      zone2: { image: '/demo-num2.svg', notice: '2️⃣ zone2 — số 2' },
      zone3: { image: '/demo-num3.svg', notice: '3️⃣ zone3 — số 3' },
      zone4: { image: '/demo-num4.svg', notice: '4️⃣ zone4 — số 4' },
      zone5: { image: '/demo-num5.svg', notice: '5️⃣ zone5 — số 5' },
      zone6: { image: '/demo-num6.svg', notice: '6️⃣ zone6 — số 6' },
      cham_khac: {
        image: '/demo-deadzone-tap6.svg',
        notice: '⚠️ cham_khac — vùng chết ở tâm (r = 63px) hoặc ngoài vòng tròn',
      },
    },
  },
  swipe: {
    name: 'Vuốt 4 hướng',
    image: '/demo-swipe.svg',
    caption: 'Bé hãy vuốt lên ⬆️, xuống ⬇️, trái ⬅️ hoặc phải ➡️ nhé!',
    icon: '⬆️ ⬇️ ⬅️ ➡️',
    branches: {
      vuot_len: { image: '/demo-swipe-up.svg', notice: '🚀 vuot_len — bay vút lên!' },
      vuot_xuong: { image: '/demo-swipe-down.svg', notice: '🕳️ vuot_xuong — chui xuống hang!' },
      vuot_trai: { image: '/demo-swipe-left.svg', notice: '⬅️ vuot_trai — lùi lại!' },
      vuot_phai: { image: '/demo-swipe-right.svg', notice: '➡️ vuot_phai — tiến lên!' },
      cham_khac: {
        image: '/demo-deadzone-swipe.svg',
        notice: '⚠️ cham_khac — vuốt chưa đủ 60px, quá 800ms, hoặc chéo không rõ trục',
      },
    },
  },
};

export function TouchTestPanel() {
  const setActivity = useSimulatorStore((state) => state.setActivity);
  const exitActivity = useSimulatorStore((state) => state.exitActivity);
  const touchLayout = useSimulatorStore((state) => state.activity.touchLayout);
  const lastTouch = useSimulatorStore((state) => state.lastTouch);

  // Which layout this panel is driving, if any. Read from a ref inside the
  // effect so a press does not have to wait for a re-render to be attributed.
  const running = useRef<TouchLayoutType | null>(null);
  const restore = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = (layout: TouchLayoutType) => {
    if (restore.current) clearTimeout(restore.current);
    running.current = layout;
    const demo = DEMOS[layout];
    setActivity({
      kind: 'lesson',
      title: `Thử layout: ${layout}`,
      phase: 'touching',
      waitingFor: 'touch',
      touchLayout: layout,
      imageUrl: demo.image,
      caption: demo.caption,
      notice: null,
      error: null,
    });
  };

  const close = () => {
    if (restore.current) clearTimeout(restore.current);
    restore.current = null;
    running.current = null;
    exitActivity();
  };

  // Stand in for the script: show the branch the press resolved to, then put the
  // question back so the next zone can be tried without reopening the panel.
  useEffect(() => {
    const layout = running.current;
    if (!lastTouch || !layout) return;

    const demo = DEMOS[layout];
    const branch = demo.branches[lastTouch.result];

    setActivity({
      phase: 'playing',
      waitingFor: null,
      imageUrl: branch ? branch.image : demo.image,
      notice: branch ? branch.notice : `👉 nhận diện: ${lastTouch.result}`,
    });

    restore.current = setTimeout(() => {
      if (running.current !== layout) return;
      setActivity({
        phase: 'touching',
        waitingFor: 'touch',
        imageUrl: demo.image,
        caption: demo.caption,
        notice: null,
      });
    }, BRANCH_DWELL_MS);

    return () => {
      if (restore.current) clearTimeout(restore.current);
    };
  }, [lastTouch, setActivity]);

  useEffect(() => () => {
    if (restore.current) clearTimeout(restore.current);
  }, []);

  return (
    <Panel title="Thử nghiệm cảm ứng (PRD v2)">
      <div className="flex flex-col gap-2.5">
        <p className="text-xs leading-relaxed text-ink-600">
          Mở một layout rồi <b>chạm hoặc vuốt trực tiếp</b> lên màn hình tròn bên trái. Vòng xanh lá
          là cửa sổ chờ; mỗi vùng dẫn tới một nhánh giả để đối chiếu với hình minh hoạ.
        </p>

        <div className="flex flex-col gap-1.5">
          {TOUCH_LAYOUTS.map((layout) => {
            const demo = DEMOS[layout];
            const active = touchLayout === layout;
            return (
              <button
                key={layout}
                type="button"
                onClick={() => open(layout)}
                className={`flex items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition active:scale-[0.98] ${
                  active
                    ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500'
                    : 'bg-cream-200 text-ink-800 hover:bg-cream-300'
                }`}
              >
                <div className="flex flex-col">
                  <span className="font-bold">{layout}</span>
                  <span className={`text-[11px] ${active ? 'text-emerald-100' : 'text-ink-500'}`}>
                    {demo.name}
                  </span>
                </div>
                <span className="text-sm tracking-widest">{demo.icon}</span>
              </button>
            );
          })}
        </div>

        {touchLayout && (
          <div className="mt-1 flex flex-col gap-2 rounded-xl bg-ink-900 p-3 text-cream-100">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-400">● Đang mở: {touchLayout}</span>
              <button
                type="button"
                onClick={close}
                className="rounded-full bg-cream-100/20 px-2.5 py-0.5 text-[11px] font-semibold text-cream-200 hover:bg-cream-100/30"
              >
                Đóng
              </button>
            </div>
            <p className="text-[11px] text-cream-300">
              Kết quả gần nhất:{' '}
              <b className="font-mono text-emerald-300">{lastTouch?.result ?? '—'}</b>
            </p>
            {/* The coordinate is the only way to check a boundary by hand: a
                press that reads zone3 tells you nothing about whether it landed
                one pixel inside the line or well within the sector. */}
            {lastTouch?.point && (
              <p className="font-mono text-[10px] text-cream-400">
                ({lastTouch.point.x.toFixed(0)}, {lastTouch.point.y.toFixed(0)}) ·{' '}
                {lastTouch.durationMs ?? 0}ms
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
