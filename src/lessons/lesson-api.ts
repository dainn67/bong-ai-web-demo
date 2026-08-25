/**
 * The three backend calls a lesson makes, plus the child's saved data.
 *
 * All of them sit behind `require_active_subscription` on the backend — signed
 * in *and* paying. A lapsed subscription fails exactly like a bug, which is why
 * the auth panel shows the expiry date next to the phone number.
 */

import { ApiError, request } from '../api/api-client';
import type { LessonBrain } from './lesson-node';

/** How a question turned out. Maps one-to-one onto a node's branches. */
export type AnswerResult = 'correct' | 'wrong' | 'silent' | 'responded';

export interface AnswerJudgement {
  result: AnswerResult;
  /** A kid-facing sentence from the grader, shown briefly on the glass. */
  reason: string | null;
}

export function answerResultFromJson(raw: unknown): AnswerResult {
  switch (String(raw ?? '').toLowerCase()) {
    case 'correct':
    case 'correct_answer':
      return 'correct';
    case 'silent':
    case 'silent_answer':
    case 'no_speech':
      return 'silent';
    default:
      // Everything else, an API error included, reads as wrong. A lesson that
      // stalls on an ambiguous grade is worse than one that moves on.
      return 'wrong';
  }
}

/**
 * Câu hỏi 2 — `POST /lessions/check-text`.
 *
 * Multipart, not JSON: that is what the endpoint accepts. The expected answer
 * is deliberately not sent — the backend derives it from the lesson metadata,
 * so the correct answer never travels over the wire in either direction.
 */
export async function checkAnswer(params: {
  text: string;
  lessonId: string;
  partId: string;
  signal?: AbortSignal;
}): Promise<AnswerJudgement> {
  const json = await request<Record<string, unknown>>('/lessions/check-text', {
    method: 'POST',
    form: { lesson_id: params.lessonId, part_id: params.partId, text: params.text },
    signal: params.signal,
  });

  return {
    result: answerResultFromJson(json.result ?? json.answer),
    reason: typeof json.reason === 'string' ? json.reason : null,
  };
}

export interface BrainRouting {
  branch: string;
  values: Record<string, unknown> | null;
  confidence: number;
}

/**
 * Câu hỏi 3 — `POST /lessions/classify`.
 *
 * The app relays the authored `brain` block untouched; nothing here interprets
 * it. The backend runs the LLM and loads any `values_from` list itself.
 */
export async function classifyAnswer(params: {
  brain: LessonBrain;
  childText: string;
  signal?: AbortSignal;
}): Promise<BrainRouting> {
  const { brain } = params;
  const json = await request<Record<string, unknown>>('/lessions/classify', {
    method: 'POST',
    timeoutMs: CLASSIFY_TIMEOUT_MS,
    signal: params.signal,
    body: {
      instruction: brain.instruction,
      branches: brain.branches.map((b) => ({
        name: b.name,
        desc:
          b.extract && b.extract.length > 0 ? `${b.desc} (trích: ${b.extract.join(', ')})` : b.desc,
      })),
      child_text: params.childText,
      ...(brain.valuesFrom ? { values_from: brain.valuesFrom } : {}),
    },
  });

  return {
    branch: String(json.branch ?? 'other'),
    values: isRecord(json.values) ? json.values : null,
    confidence: typeof json.confidence === 'number' ? json.confidence : 0,
  };
}

/**
 * How long the classifier gets.
 *
 * The app is inconsistent here in a way that costs real answers: its engine
 * aborts at 10s while its own HTTP client allows 25s, and the client's comment
 * says classify "routinely takes ~9s". The engine wins, so a valid but slow
 * classification is discarded as silence. One number, above the observed
 * latency, and the engine does not impose a second shorter one.
 */
export const CLASSIFY_TIMEOUT_MS = 30_000;

/**
 * The child's saved values, cached for the session.
 *
 * The backend holds the storage credentials and derives the child from the
 * token, so no identity is sent. The cache is written before the POST so a
 * `save` is visible to a `{data.*}` recall later in the same lesson without a
 * round trip — spec §7.1.
 */
export class LessonDataStore {
  private readonly values = new Map<string, Map<string, string>>();
  private readonly categories = new Map<string, string[]>();

  /** Fetches exactly the buckets this lesson references. */
  async preload(categories: string[]): Promise<void> {
    await Promise.all(
      [...new Set(categories)].map(async (category) => {
        try {
          const json = await request<Record<string, unknown>>(`/lessions/data/${category}`);
          const raw = isRecord(json.values) ? json.values : {};
          const bucket = new Map<string, string>();
          for (const [key, value] of Object.entries(raw)) bucket.set(key, String(value));
          this.values.set(category, bucket);
        } catch {
          // A 404 is a new child, not a failure. An empty bucket is the right
          // answer either way — the read node's `chua_co` branch handles it.
          this.values.set(category, new Map());
        }
      }),
    );
  }

  /**
   * Loads the shared value lists used by `values_from`.
   *
   * These live on the open CDN rather than behind the API, so this works signed
   * out — which matters because failing to load them is not the same as an
   * empty list: a read node that cannot tell `match` from `not_in_list` skips
   * itself rather than routing everyone down the wrong branch.
   */
  async preloadCategories(): Promise<void> {
    try {
      const response = await fetch('/cdn/data/index.json');
      if (!response.ok) return;
      const json = (await response.json()) as Record<string, unknown>;
      const list = Array.isArray(json.common) ? json.common : [];
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        const name = typeof entry.category === 'string' ? entry.category : null;
        if (!name || !Array.isArray(entry.values)) continue;
        this.categories.set(
          name,
          entry.values.filter(isRecord).map((v) => String(v.id ?? '')).filter(Boolean),
        );
      }
    } catch {
      // Leaves `categoryValues` returning undefined, which read nodes read as
      // "cannot decide" and skip. That is the safe direction.
    }
  }

  value(category: string, key: string): string | undefined {
    return this.values.get(category)?.get(key);
  }

  /** Valid ids for a shared category, or undefined when the list is unavailable. */
  categoryValues(category: string): string[] | undefined {
    return this.categories.get(category);
  }

  async save(category: string, key: string, value: string): Promise<void> {
    // Cache first: a recall later in this lesson must see the new value even if
    // the network write is still in flight or fails outright.
    const bucket = this.values.get(category) ?? new Map<string, string>();
    bucket.set(key, value);
    this.values.set(category, bucket);

    try {
      await request(`/lessions/data/${category}`, {
        method: 'POST',
        query: { mode: 'append' },
        body: { values: { [key]: value } },
      });
    } catch {
      // Best effort. The lesson continues with the cached value.
    }
  }
}

/** Saves a resume point. Fire-and-forget: progress must never block playback. */
export async function saveProgress(params: {
  lessonId: string;
  status: 'learning' | 'completed';
  resumeMs?: number;
  category?: string;
  metadataUrl?: string;
  title?: string;
}): Promise<void> {
  try {
    await request('/lessions/progress', {
      method: 'POST',
      body: {
        lesson_id: params.lessonId,
        status: params.status,
        timestamp_ms: params.resumeMs ?? 0,
        ...(params.category ? { category: params.category } : {}),
        ...(params.metadataUrl ? { metadata_url: params.metadataUrl } : {}),
        ...(params.title ? { title: params.title } : {}),
      },
    });
  } catch {
    // Silent by design.
  }
}

/** Whether a failure was the subscription gate rather than a transport problem. */
export function isSubscriptionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
