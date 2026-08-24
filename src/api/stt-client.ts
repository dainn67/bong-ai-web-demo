/**
 * Speech to text, via the FunASR service.
 *
 * Worth knowing what this actually does: the child's recorded audio is uploaded
 * to a transcription service that sits outside the app's authenticated API
 * gateway and takes no credentials. The Flutter app does the same — its
 * `serverStt` setting defaults on — though its own lesson documentation still
 * claims audio never leaves the device, which stopped being true when this
 * became the default path.
 *
 * The app also ships an on-device recogniser as the alternative. Porting one
 * into the browser would mean shipping a model, which is not a trade a test
 * harness should make; but the upload is a real property of this tool and
 * should not be discovered by surprise.
 */

import { pcm16ToWav } from '../audio/wav';

/** Where the proxy puts the FunASR host. See `/stt` in vite.config. */
const STT_URL = '/stt/api/stt/transcribe';

const TIMEOUT_MS = 20_000;

export class SttError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SttError';
  }
}

/**
 * Transcribes one turn.
 *
 * Returns '' when the service ran but heard nothing — that is a silent turn,
 * not a failure, and the caller routes it to the `silent` branch. A transport
 * failure throws instead, so "we could not hear you" is distinguishable from
 * "you said nothing"; the app conflated these and the child's answer looked
 * ignored.
 */
export async function transcribe(
  pcm: Int16Array,
  sampleRate: number,
  options: { language?: string; signal?: AbortSignal } = {},
): Promise<string> {
  if (pcm.length === 0) return '';

  const form = new FormData();
  // The field is `audio`, not the `file` you would guess — the service reports
  // `{"loc": ["body", "audio"], "msg": "Field required"}` for anything else.
  form.append('audio', pcm16ToWav(pcm, sampleRate), 'turn.wav');
  form.append('language', options.language ?? 'vi');

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(STT_URL, { method: 'POST', body: form, signal });
  } catch (error) {
    throw new SttError(`Không gọi được nhận diện giọng nói: ${String(error)}`);
  }

  if (!response.ok) throw new SttError(`Nhận diện giọng nói lỗi (HTTP ${response.status})`);

  const json: unknown = await response.json().catch(() => null);
  if (typeof json !== 'object' || json === null) {
    throw new SttError('Không đọc được kết quả nhận diện');
  }

  const record = json as Record<string, unknown>;
  const text = record.text ?? record.raw_text ?? '';
  return typeof text === 'string' ? text.trim() : '';
}

/**
 * Whether transcribed text carries an actual word.
 *
 * Ambient noise sometimes decodes to a stray punctuation token. Requiring a
 * letter or a digit is what stops that being echoed back as something the child
 * said — the same test the app applies for "có phản hồi".
 */
export function hasSpeechContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
