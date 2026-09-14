/**
 * Text sanitization for interpolation-input expert files (design §1, decision
 * #9 — inherited from the wb-market empirical lessons #6/#14 and ported from
 * its scanner): role.md and SKILL.md bodies are interpolated into the system
 * prompt, so before any of that text reaches the prompt pipeline:
 *
 *   - every `\r` is stripped (BOM too): a CRLF file silently took the
 *     degraded path in the sister plugin's real corpus;
 *   - every `{{…}}` group whose name is NOT a registered prompt variable has
 *     its braces split (`{{` → `{ {`): an unregistered group with a later
 *     `}}` makes the host interpolator THROW and killed session startup.
 *
 * The registered-variable whitelist is DATA (model/cwd/provider — exactly
 * what the running harness registers), not scattered literals, so it grows
 * with the real registration set.
 */

/**
 * Prompt variables the running harness registers. Kept as data so the
 * whitelist grows by editing one array.
 */
export const REGISTERED_PROMPT_VARIABLES = ['model', 'cwd', 'provider']

const REGISTERED_VARIABLE_SET = new Set(REGISTERED_PROMPT_VARIABLES)

/** Host interpolator's variable-name rule (dsh-system-prompt VARIABLE_NAME). */
const VARIABLE_NAME_RE = /^[a-z][a-z0-9_]*$/

/** A complete `{{...}}` reference group at the scan position. */
const GROUP_AT_RE = /^\{\{([^{}]*)\}\}/

/** Strip a UTF-8 BOM, then normalize newlines: `\r\n`/lone `\r` → `\n`. */
export function normalizeNewlines(text) {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, '\n')
}

/**
 * One escaping pass that mirrors the host interpolator's scan exactly:
 * at each `{{` —
 *   - a complete group whose name is a registered variable stays intact;
 *   - a complete group with any other name gets its braces split;
 *   - an incomplete group (nested braces) with a later `}}` in the text would
 *     make the interpolator THROW, so its braces are split too;
 *   - an incomplete group with no later `}}` is literal prose for the
 *     interpolator and is kept as-is.
 * Returns { text, changed } so the caller can iterate to a fixpoint — a
 * single pass can leave a fresh `{{` behind when three or more braces were
 * adjacent (`{{{x}}}` → `{ {{x}}}`), and each split strictly reduces the
 * total number of `{{` pairs, so the loop terminates.
 */
function escapeOnePass(text) {
  let out = ''
  let last = 0
  let changed = false
  for (let open = text.indexOf('{{', last); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT_RE.exec(text.slice(open))
    if (group !== null) {
      const name = group[0].slice(2, -2)
      if (VARIABLE_NAME_RE.test(name) && REGISTERED_VARIABLE_SET.has(name)) {
        out += text.slice(last, open + group[0].length)
        last = open + group[0].length
        continue
      }
    } else if (text.indexOf('}}', open + 2) < 0) {
      // Lone `{{` with no closing braces anywhere later: literal prose.
      out += text.slice(last, open + 2)
      last = open + 2
      continue
    }
    out += text.slice(last, open) + '{ {'
    last = open + 2
    changed = true
  }
  return { text: out + text.slice(last), changed }
}

/**
 * Split the braces of every non-registered `{{…}}` group (`{{` → `{ {`) so
 * the text can never fail the interpolator, while registered groups survive
 * verbatim. Iterates to a fixpoint (see escapeOnePass).
 * @param {string} text - already newline-normalized text
 * @returns {string} safe text
 */
export function escapeUnregisteredTemplateGroups(text) {
  let current = text
  for (;;) {
    const pass = escapeOnePass(current)
    if (!pass.changed) return current
    current = pass.text
  }
}

/**
 * Full sanitize pipeline for one interpolation-input file body: BOM/CRLF
 * normalization, then template-group escaping.
 * @param {string} raw - the file's raw utf8 content
 * @returns {string} safe text
 */
export function sanitizeText(raw) {
  return escapeUnregisteredTemplateGroups(normalizeNewlines(raw))
}
