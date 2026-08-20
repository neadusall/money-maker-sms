/**
 * OS Text · Spintax (send-time content diversity)
 *
 * Ported from the RecruitersOS email engine (integration/lib/copy/spintax.ts) because
 * `money-maker-sms` is a SEPARATE build and cannot import across the repo boundary. The
 * SYNTAX is identical, so a recruiter who learned spintax writing cold email writes it the
 * same way here. Two things differ deliberately:
 *
 *   - `pickIndex` avalanches the hash before the modulo (see below). The email engine's
 *     raw FNV-1a silently collapses correlated spin groups; that matters far more at 200
 *     texts a day off one long code than it does across a mailbox fleet. The email side
 *     has the same weakness and is worth fixing there too.
 *   - `variantCount` / `checkSpin` / `minVariantsFor` are SMS-only, because carrier
 *     filtering punishes repetition harder than mailbox providers do and a recruiter needs
 *     to be told BEFORE sending that a two-branch template cannot carry 200 sends a day.
 *
 * Both changes alter which branch a given seed picks, so a template rendered by the email
 * engine and this one will not match word for word. Nothing depends on that.
 *
 * Why it matters on this lane: carriers (T-Mobile/AT&T/Verizon) fingerprint message BODIES.
 * Two hundred byte-identical texts from one long code is the exact pattern that gets a
 * number filtered. One approved template written with inline spintax gives every recipient
 * a different surface form of the same approved message:
 *
 *     "{Saw|Noticed} {{company}} is hiring"   ->  half get "Saw", half "Noticed"
 *
 * Rules:
 *  - A spin group is `{a|b|c}` — braces with at least one `|`. A branch may be empty
 *    (`{|x}`) for optional text, and groups may nest.
 *  - `{{mergeField}}` tokens are LEFT ALONE (renderTemplate fills them). Merge fields may
 *    even sit INSIDE a spin branch — they're protected during expansion and restored after.
 *  - Selection is DETERMINISTIC from `seed` (the contact id): the same contact always
 *    renders the same wording, so a retry after a network failure cannot deliver a second,
 *    differently-worded copy of the same message. No Math.random.
 *
 * NOTE ON COMPLIANCE: the STOP footer is appended AFTER expansion, at the send chokepoint,
 * and is never part of the spun body. A spin group can therefore never vary, weaken, or
 * delete the opt-out instruction.
 */

/**
 * FNV-1a hash of `s`, avalanched, -> index in [0, n). Stable, no RNG.
 *
 * THE FINALIZER IS NOT OPTIONAL. Raw FNV-1a has notoriously weak low bits: modulo a power
 * of two, the result depends only on the low bits of the input bytes. Two spin groups whose
 * branches differ only in high bits pick the SAME index for every seed, so
 *
 *     "{a|b|c|d|e|f|g|h}{1|2|3|4|5|6|7|8}"
 *
 * rendered 8 outputs instead of 64 (always a1, b2, c3 ... because 'a' and '1' share their
 * low three bits). On a 200/day line that is the difference between the diversity the
 * template advertises and eight distinct bodies going to two hundred people, which is
 * exactly the repetition carriers fingerprint. The murmur3 finalizer below mixes high bits
 * down before the modulo so every group chooses independently.
 */
function pickIndex(s: string, n: number): number {
  if (n <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) % n;
}

// ASCII control-char sentinels standing in for `{{` / `}}` during expansion, so the spin
// parser (which keys off SINGLE braces) never mistakes a merge field for a spin group.
// NUL/SOH never appear in SMS copy. Restored verbatim at the end.
const OPEN = String.fromCharCode(0);
const CLOSE = String.fromCharCode(1);
const OPEN_RE = new RegExp(OPEN, "g");
const CLOSE_RE = new RegExp(CLOSE, "g");

const GROUP = /\{([^{}]*\|[^{}]*)\}/; // innermost group carrying a pipe

/**
 * Expand every `{a|b}` spin group in `text`, choosing a branch deterministically from
 * `seed`. `{{mergeField}}` tokens pass through untouched (even inside a chosen branch).
 * Innermost groups resolve first, so nesting works. Returns `text` unchanged when there is
 * nothing to spin — a plain template still sends, it just gets no diversity protection.
 */
export function expandSpintax(text: string, seed = ""): string {
  if (!text || text.indexOf("|") === -1) return text;
  let s = text.replace(/\{\{/g, OPEN).replace(/\}\}/g, CLOSE);
  let guard = 0;
  while (guard++ < 2000) {
    const m = s.match(GROUP);
    if (!m || m.index === undefined) break;
    const options = m[1].split("|");
    // `guard` (the group's resolution ordinal) joins the seed so two IDENTICAL groups in one
    // template - "{Hi|Hey} ... {Hi|Hey}" - choose independently instead of always matching.
    const choice = options[pickIndex(`${seed}|${guard}|${m[1]}`, options.length)] ?? "";
    // slice-splice (not String.replace) so a `$` in the chosen branch inserts literally.
    s = s.slice(0, m.index) + choice + s.slice(m.index + m[0].length);
  }
  return s.replace(OPEN_RE, "{{").replace(CLOSE_RE, "}}");
}

/**
 * How many DISTINCT bodies this template can produce — the product of every spin group's
 * branch count. This is the number the sending UI shows, because it is the only honest
 * answer to "will 200 sends a day look like one blast?"
 *
 * Capped at 1e9 so a pathological template can't overflow into Infinity and read as
 * "infinite diversity" in the UI.
 */
export function variantCount(text: string): number {
  if (!text) return 0;
  let s = text.replace(/\{\{/g, OPEN).replace(/\}\}/g, CLOSE);
  let total = 1;
  let guard = 0;
  while (guard++ < 2000) {
    const m = s.match(GROUP);
    if (!m || m.index === undefined) break;
    total = Math.min(1e9, total * m[1].split("|").length);
    // Collapse the group to its first branch and keep walking outward, so nested groups
    // multiply exactly once each.
    s = s.slice(0, m.index) + (m[1].split("|")[0] ?? "") + s.slice(m.index + m[0].length);
  }
  return total;
}

/**
 * The diversity bar for a high-volume lane. At 200 sends/day you want a comfortable
 * multiple of the daily volume in possible renderings, or the pigeonhole principle hands
 * carriers repeats anyway. 5x the daily cap is the floor we warn below.
 */
export function minVariantsFor(dailyCap: number): number {
  return Math.max(20, dailyCap * 5);
}

export interface SpinCheck {
  variants: number;
  required: number;
  ok: boolean;
  /** Unbalanced braces — a typo that would ship literal `{` characters to a candidate. */
  malformed: boolean;
}

/**
 * Pre-send verdict on a template's diversity, for the campaign editor. `malformed` catches
 * the common typo (a missing closing brace) BEFORE it reaches a candidate's phone as
 * "Hi {{firstName}, {saw|noticed".
 */
export function checkSpin(text: string, dailyCap: number): SpinCheck {
  const stripped = (text ?? "").replace(/\{\{/g, "").replace(/\}\}/g, "");
  const opens = (stripped.match(/\{/g) ?? []).length;
  const closes = (stripped.match(/\}/g) ?? []).length;
  const variants = variantCount(text);
  const required = minVariantsFor(dailyCap);
  return { variants, required, ok: variants >= required, malformed: opens !== closes };
}
