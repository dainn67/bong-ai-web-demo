/**
 * Runtime placeholders in lesson strings.
 *
 * Three tokens resolve while a lesson runs: `{values.*}` (what the classifier
 * extracted this turn), `{data.*}` (a value saved for this child in an earlier
 * session) and `{value}` (the single scalar belonging to the branch being
 * played). `{userPhone}` and `{voiceID}` are different — they come from the
 * account and are substituted once at parse time.
 *
 * **The golden rule (spec §8.3): an unresolved token poisons the whole string.**
 * The caller then skips that clip or that save entirely. A missing value has to
 * vanish in silence — never play an error, never persist the literal text
 * `"{value}"`, which is precisely what broke read-back in the app once.
 */

const VALUES_RE = /\{values\.([^}]+)\}/g;
const DATA_RE = /\{data\.([^.}]+)\.([^}]+)\}/g;

export interface ResolveContext {
  /** Values the classifier extracted this turn, keyed by name. */
  values?: Record<string, unknown> | null;
  /** Looks up a saved value for this child. */
  dataLookup?: (category: string, key: string) => string | undefined | null;
  /** The current branch's scalar, from a read node or a câu hỏi 3 extraction. */
  branchValue?: string | null;
}

/**
 * Substitutes every runtime token, or returns null if any of them cannot be.
 *
 * A string with no tokens comes back unchanged, so this is safe to call on
 * every clip rather than only the ones that look interesting.
 */
export function resolvePlaceholders(input: string, context: ResolveContext): string | null {
  let out = input;

  if (out.includes('{value}')) {
    // `{value}` resolves only from a branch scalar. Without one the token is
    // unresolved — the same as a missing `{data.*}` — so the caller skips.
    if (!context.branchValue) return null;
    out = out.replaceAll('{value}', context.branchValue);
  }

  let ok = true;

  out = out.replace(VALUES_RE, (whole, name: string) => {
    const value = context.values?.[name];
    if (value === undefined || value === null || String(value).length === 0) {
      ok = false;
      return whole;
    }
    return String(value);
  });

  out = out.replace(DATA_RE, (whole, category: string, key: string) => {
    const value = context.dataLookup?.(category, key);
    if (!value) {
      ok = false;
      return whole;
    }
    return value;
  });

  return ok ? out : null;
}

/**
 * Every `{data.<category>.*}` category a string mentions.
 *
 * Used to preload exactly the buckets a lesson needs before it starts, rather
 * than discovering them one round trip at a time mid-playback.
 */
export function dataCategoriesIn(input: string): string[] {
  const out: string[] = [];
  for (const match of input.matchAll(DATA_RE)) out.push(match[1]);
  return out;
}

/**
 * Fills the account-scoped tokens, which are known before playback starts.
 *
 * Unlike the runtime tokens, an unresolved one here is left as-is rather than
 * poisoning the string: the caller checks for a leftover `{` and skips. Keeping
 * the raw token in the URL makes a missing account visible in the log instead
 * of turning into a silent null two layers away.
 */
export function resolveAccountPlaceholders(
  input: string,
  account: { phone?: string | null; voiceId?: string | null },
): string {
  let out = input;
  if (account.phone) out = out.replaceAll('{userPhone}', account.phone);
  if (account.voiceId) out = out.replaceAll('{voiceID}', account.voiceId);
  return out;
}

/** Whether a string still has an unfilled token in it. */
export function hasUnresolvedToken(input: string): boolean {
  return /\{[a-zA-Z][^}]*\}/.test(input);
}
