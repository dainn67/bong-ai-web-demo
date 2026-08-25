/**
 * The lesson catalog, as the badge would fetch it.
 *
 * One public JSON on the CDN listing everything the device can play: stories in
 * one bucket, lessons in another, flattened here into a single list the way the
 * app does. No auth — which is what lets the menu render before anyone signs in.
 */

/** Where the proxy puts the static CDN. See the `/cdn` route in vite.config. */
export const CDN_BASE = '/cdn';

const CATALOG_URL = `${CDN_BASE}/lessions/lessions.json`;

export type LessonCategory = 'stories' | 'learning';

export interface LessonSummary {
  id: string;
  title: string;
  description: string;
  category: LessonCategory;
  /** Absolute-through-the-proxy URL of this lesson's `metadata.json`. */
  metadataUrl: string;
  /** Cover art, or null when the entry ships none. */
  coverUrl: string | null;
}

interface CatalogEntry {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  cover_url?: unknown;
  data_url?: unknown;
}

/**
 * Fetches and flattens the catalog.
 *
 * Entries missing an id or a `data_url` are dropped rather than throwing: one
 * malformed row in a hand-edited file should cost that row, not the menu.
 */
export async function fetchCatalog(signal?: AbortSignal): Promise<LessonSummary[]> {
  const response = await fetch(CATALOG_URL, { signal });
  if (!response.ok) throw new Error(`Không tải được danh mục (HTTP ${response.status})`);
  const json: unknown = await response.json();
  return parseCatalog(json);
}

/** Pure half of {@link fetchCatalog}, so the shape handling is testable. */
export function parseCatalog(json: unknown): LessonSummary[] {
  if (!isRecord(json)) return [];
  const out: LessonSummary[] = [];

  for (const category of ['stories', 'learning'] as const) {
    const rows = json[category];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const summary = toSummary(row, category);
      if (summary) out.push(summary);
    }
  }
  return out;
}

function toSummary(row: unknown, category: LessonCategory): LessonSummary | null {
  if (!isRecord(row)) return null;
  const entry = row as CatalogEntry;
  const id = asString(entry.id);
  const dataUrl = asString(entry.data_url);
  if (!id || !dataUrl) return null;

  return {
    id,
    title: asString(entry.title) || id,
    description: asString(entry.description) ?? '',
    category,
    metadataUrl: cdnUrl(`${dataUrl}/metadata.json`),
    coverUrl: entry.cover_url ? cdnUrl(asString(entry.cover_url)!) : null,
  };
}

/**
 * Rewrites a catalog-relative path onto the proxy.
 *
 * The file also carries a `config.base_url` pointing at the CDN's real origin.
 * We deliberately ignore it: fetching that host directly is exactly what CORS
 * blocks, so every path is re-hosted under `/cdn` instead. A row that already
 * carries an absolute URL to some other host is left alone — those are the
 * open ones (the r2.dev clips), and routing them through the proxy would only
 * add a hop.
 */
export function cdnUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return rehostKnownCdn(path);
  return `${CDN_BASE}/${path.replace(/^\/+/, '')}`;
}

const CDN_ORIGIN = 'https://static-bongai.bcserver.xyz';
const MEDIA_ORIGIN = 'https://files.bcserver.xyz';

/**
 * Sends the two closed hosts through their proxy routes, leaves the rest alone.
 *
 * Only these two need it. The clip host answers `Access-Control-Allow-Origin: *`
 * so it is fetched directly, which keeps the bulk of the bytes off the dev
 * server.
 */
function rehostKnownCdn(url: string): string {
  if (url.startsWith(CDN_ORIGIN)) return CDN_BASE + url.slice(CDN_ORIGIN.length);
  if (url.startsWith(MEDIA_ORIGIN)) return '/media' + url.slice(MEDIA_ORIGIN.length);
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
