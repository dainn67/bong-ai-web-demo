/**
 * The lesson catalog, from the API rather than the CDN.
 *
 * `GET /api/v1/lessions` is open — no bearer token, no subscription check — and
 * it returns the same shape the CDN's `lessions.json` does: a `config` block,
 * a `stories` array and a `learning` array. Measured, not assumed: 3 stories and
 * 17 lessons at the time of writing.
 *
 * This is the one thing the badge fetches that is not audio or a picture, and it
 * is worth being clear about why that is allowed under a thin device. The list
 * is not *content* — it does not tell the device how to run anything, and the
 * device could not act on it if it did. It is a **menu of things to ask for**.
 * The child taps a row, the badge says that lesson's name, and the server does
 * everything from there. Take the list away and the badge still works; you just
 * have to already know what to ask for.
 *
 * It comes through the same `/api` proxy that provisioning uses, so it costs no
 * extra plumbing. The CDN, the STT service and the story host stay gone.
 */

/** Where the proxy puts `bong-api.bcserver.xyz`. See `/api` in vite.config. */
const CATALOG_URL = '/api/v1/lessions';

const TIMEOUT_MS = 15_000;

export type LessonCategory = 'stories' | 'learning';

export interface LessonSummary {
  id: string;
  title: string;
  description: string;
  category: LessonCategory;
  /** Cover art, absolute. Null when the entry ships none. */
  coverUrl: string | null;
}

/**
 * Fetches the catalog.
 *
 * One malformed row costs that row, not the menu: entries with no id or no
 * title are dropped rather than throwing. A hand-edited catalog is exactly the
 * kind of thing that has one bad row in it, and a menu that refuses to open is
 * a worse outcome than a menu missing an entry.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<LessonSummary[]> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await fetch(CATALOG_URL, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw new Error(`Không tải được danh mục (HTTP ${response.status})`);
  return parseCatalog(await response.json());
}

/** Pure half of {@link fetchCatalog}, so the shape handling is testable. */
export function parseCatalog(json: unknown): LessonSummary[] {
  // `{success, data}` on the way out, like every other route on this backend.
  const root = isRecord(json) && isRecord(json.data) ? json.data : json;
  if (!isRecord(root)) return [];

  const base = isRecord(root.config) ? asString(root.config.base_url) : null;
  const out: LessonSummary[] = [];

  for (const category of ['stories', 'learning'] as const) {
    const rows = root[category];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const summary = toSummary(row, category, base);
      if (summary) out.push(summary);
    }
  }
  return out;
}

function toSummary(
  row: unknown,
  category: LessonCategory,
  base: string | null,
): LessonSummary | null {
  if (!isRecord(row)) return null;
  const id = asString(row.lesson_id) ?? asString(row.id);
  const title = asString(row.title);
  // The title is what gets said out loud to start the lesson, so a row without
  // one is unusable here even though it is a perfectly good catalog entry.
  if (!id || !title) return null;

  return {
    id,
    title,
    description: asString(row.description) ?? '',
    category,
    coverUrl: absolute(asString(row.cover_url), base),
  };
}

/**
 * Resolves a cover path against the catalog's own `config.base_url`.
 *
 * The rows carry relative paths like `lessions/S_001/cover.png`, and the base
 * comes from the response's own `config.base_url` rather than being hardcoded —
 * a catalog served from a different CDN should still resolve.
 *
 * These load straight from the CDN with no proxy. Checked: it sends no CORS
 * headers at all, which does not matter, because `<img src>` is not subject to
 * CORS — only reading pixels back out of one would be. Nothing here does that.
 */
function absolute(path: string | null, base: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
