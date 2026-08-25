/**
 * Saying things to the badge, without saying them out loud.
 *
 * Mode entry is a *sentence* now. There is no start-lesson frame in the
 * protocol and no endpoint the device can call — the child says "bắt đầu bài
 * học tiếng Anh", the server's LLM routes that to the lesson orchestrator, and
 * the badge is a speaker again. `listen`/`detect` is the same path with the
 * microphone taken out of it.
 *
 * That makes the exact wording load-bearing in a way a button never is: it is
 * matched by a language model, not a parser, so a phrase that works today can
 * stop working when the prompt changes. Hence a free-text box and not just
 * presets — when a phrase stops routing, the first thing you want is to try
 * three more without touching the code.
 *
 * How to tell it worked: the reply comes back as an `stt` frame reading
 * `% start_learning_session`. `reduceFace` deliberately keeps tool calls off
 * the badge's face, so watch the packet inspector, not the glass.
 */

import { useState } from 'react';
import { Panel } from './dev-drawer';
import { useSimulatorStore } from '../store/simulator-store';
import { MODE_INTENTS } from '../screen/menu-state';

/**
 * Phrases worth having one click away.
 *
 * The first two are the ones the mode menu sends, so this panel and the glass
 * cannot drift apart. The rest are the cases from the backend's architecture
 * doc (§0.1) that the menu has no button for: resuming yesterday's lesson, and
 * getting back out to free chat.
 */
const PRESETS: readonly string[] = [
  MODE_INTENTS.lesson ?? '',
  MODE_INTENTS.story ?? '',
  'Tiếp tục bài học hôm qua',
  'Con muốn dừng bài học',
].filter(Boolean);

export function IntentPanel() {
  const sendText = useSimulatorStore((state) => state.sendText);
  const connected = useSimulatorStore((state) => state.status === 'connected');
  const [text, setText] = useState('');

  const say = (phrase: string) => {
    if (!connected || !phrase.trim()) return;
    sendText(phrase);
    setText('');
  };

  return (
    <Panel title="Ý định">
      <p className="text-xs leading-snug text-ink-500">
        Gửi như lời nói (<code>listen/detect</code>) — máy chủ tự chọn bài và
        điều khiển. Thiết bị không gọi API bài học nữa.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((phrase) => (
          <button
            key={phrase}
            type="button"
            onClick={() => say(phrase)}
            disabled={!connected}
            className="rounded-full bg-cream-100 px-3 py-1.5 text-xs font-semibold text-ink-700 transition active:scale-95 disabled:opacity-40"
          >
            {phrase}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && say(text)}
          placeholder="Câu khác…"
          className="min-w-0 flex-1 rounded-xl bg-cream-100 px-3 py-2 text-sm outline-none ring-coral-400 focus:ring-2"
        />
        <button
          type="button"
          onClick={() => say(text)}
          disabled={!connected || !text.trim()}
          className="rounded-xl bg-coral-500 px-3 py-2 text-sm font-bold text-white transition active:scale-95 disabled:opacity-40"
        >
          Gửi
        </button>
      </div>

      {!connected && (
        <p className="text-[11px] font-medium text-ink-500">Chưa kết nối — bấm ⏻ để đánh thức.</p>
      )}
    </Panel>
  );
}
