/**
 * The public matcher.
 *
 * Deliberately shaped like `RegExp`: `test`, `exec`, `lastIndex`, and the
 * `String.prototype` operations as methods. A drop-in shape means a caller
 * can swap one for the other to compare behaviour, which is how most of this
 * engine was tested.
 */

import { compile } from './compiler.js';
import { parse } from './parser.js';
import { parseFlags, renderFlags } from './flags.js';
import { run } from './pike.js';
import { render } from './ast.js';
import { simplify } from './simplify.js';

/** A compiled pattern, ready to match against any number of subjects. */
export class Regex {
  /**
   * @param {string} pattern the pattern text
   * @param {string} [flags] the flag letters
   */
  constructor(pattern, flags = '') {
    if (typeof pattern !== 'string') {
      throw new TypeError(`a pattern must be a string, got ${typeof pattern}`);
    }

    this.source = pattern;
    this.flags = parseFlags(flags);

    const parsed = parse(pattern, this.flags);
    this.ast = simplify(parsed.node);
    this.groupCount = parsed.groupCount;
    this.names = parsed.names;

    this.program = compile(this.ast, {
      groupCount: parsed.groupCount,
      flags: this.flags,
      names: parsed.names,
      pattern,
    });

    /**
     * Where the next `exec` starts, for `g` and `y`.
     *
     * Mutable state on the object, which is `RegExp`'s design and not a good
     * one -- it makes a compiled pattern unsafe to share between callers. It
     * is kept because the whole point of this class is to behave the same
     * way, and {@link Regex#matchAll} exists for callers who want the
     * stateless version.
     */
    this.lastIndex = 0;
  }

  /**
   * Whether the pattern matches anywhere in the subject.
   *
   * @param {string} subject the text to search
   * @returns {boolean} true when it matches
   */
  test(subject) {
    return this.exec(subject) !== null;
  }

  /**
   * Finds the next match, honouring `lastIndex` under `g` or `y`.
   *
   * @param {string} subject the text to search
   * @returns {object|null} a match object, or null
   */
  exec(subject) {
    const text = String(subject);
    const stateful = this.flags.global || this.flags.sticky;
    const start = stateful ? this.lastIndex : 0;

    if (start > text.length) {
      this.lastIndex = 0;
      return null;
    }

    const slots = run(this.program, text, start, { anchored: this.flags.sticky });

    if (slots === null) {
      if (stateful) this.lastIndex = 0;
      return null;
    }

    const match = this.buildMatch(text, slots);

    if (stateful) {
      // An empty match has to advance lastIndex by one or `g` would loop for
      // ever on the same position. `RegExp` has the same rule and callers
      // rely on it, so `/a*/g` over "bb" yields three empty matches rather
      // than hanging.
      this.lastIndex = match.index + (match[0].length === 0 ? 1 : match[0].length);
    }

    return match;
  }

  /**
   * Every match, as an iterable, without touching `lastIndex`.
   *
   * The stateless counterpart to `exec` in a loop. Preferred for that
   * reason: a shared `Regex` used from two places with `g` set will
   * interleave its `lastIndex` and silently skip matches.
   *
   * @param {string} subject the text to search
   * @param {object} [options]
   * @param {boolean} [options.all] scan the whole subject regardless of the
   *     `g` flag. `split` needs this: `String.prototype.split` ignores `g`
   *     and always breaks on every occurrence, so inheriting the flag here
   *     made /,/ split only once.
   * @yields {object} each match
   */
  * matchAll(subject, { all = this.flags.global || this.flags.sticky } = {}) {
    const text = String(subject);
    let at = 0;

    while (at <= text.length) {
      const slots = run(this.program, text, at, { anchored: this.flags.sticky });
      if (slots === null) return;

      const match = this.buildMatch(text, slots);
      yield match;

      at = match.index + (match[0].length === 0 ? 1 : match[0].length);

      // Without `g` or `y`, one match is all a caller asked for.
      if (!all) return;
    }
  }

  /**
   * The first match, or null, ignoring `lastIndex`.
   *
   * @param {string} subject the text to search
   * @returns {object|null} the match
   */
  match(subject) {
    for (const found of this.matchAll(subject)) return found;
    return null;
  }

  /**
   * Replaces matches with a string or the result of a function.
   *
   * A `$1`-style replacement string supports `$1`-`$99`, `$&`, `` $` ``,
   * `$'`, `$<name>` and `$$`, as `String.prototype.replace` does.
   *
   * @param {string} subject the text to search
   * @param {string|Function} replacement the replacement
   * @returns {string} the result
   */
  replace(subject, replacement) {
    const text = String(subject);
    const once = !this.flags.global;

    let out = '';
    let cursor = 0;

    for (const found of this.matchAll(text)) {
      out += text.slice(cursor, found.index);
      out += typeof replacement === 'function'
        ? String(replacement(...found, found.index, text, found.groups))
        : expand(replacement, found, text);
      cursor = found.index + found[0].length;
      if (once) break;
    }

    return out + text.slice(cursor);
  }

  /**
   * Splits the subject on matches.
   *
   * Capture groups are interleaved into the result, as
   * `String.prototype.split` does with a `RegExp` separator.
   *
   * @param {string} subject the text to split
   * @param {number} [limit] the most pieces to return
   * @returns {string[]} the pieces
   */
  split(subject, limit = Infinity) {
    const text = String(subject);
    if (limit === 0) return [];

    // An empty subject splits to nothing when the separator matches it, and
    // to one empty piece when it does not. `''.split(//)` is `[]` while
    // `''.split(/x/)` is `['']`, and the asymmetry is easy to miss.
    if (text === '') {
      return this.match('') === null ? [''] : [];
    }

    const out = [];
    let cursor = 0;

    for (const found of this.matchAll(text, { all: true })) {
      // A zero-width match at the cursor would produce an empty piece and
      // make no progress, which is how a naive split on `//` loops.
      if (found[0].length === 0 && found.index === cursor) continue;

      // A zero-width match at the very end is not a separator either.
      // `'abc'.split(//)` is three pieces, not four: without this the final
      // empty match splits off a trailing empty string.
      if (found[0].length === 0 && found.index === text.length) continue;

      out.push(text.slice(cursor, found.index));
      for (let i = 1; i < found.length; i++) out.push(found[i]);
      cursor = found.index + found[0].length;

      if (out.length >= limit) return out.slice(0, limit);
    }

    out.push(text.slice(cursor));
    return out.slice(0, limit);
  }

  /** Builds the match object from raw capture slots. */
  buildMatch(text, slots) {
    const match = [];

    for (let group = 0; group <= this.groupCount; group++) {
      const from = slots[group * 2];
      const to = slots[group * 2 + 1];
      // A group that never participated reads as undefined rather than as an
      // empty string, which is the distinction `(a)|(b)` depends on.
      match.push(from >= 0 && to >= 0 ? text.slice(from, to) : undefined);
    }

    match.index = slots[0];
    match.input = text;

    if (this.names.size > 0) {
      match.groups = Object.create(null);
      for (const [name, number] of this.names) {
        match.groups[name] = match[number];
      }
    } else {
      match.groups = undefined;
    }

    return match;
  }

  /**
   * The pattern as the engine understands it, after simplification.
   *
   * Useful for seeing what was actually compiled: `a{1,1}` comes back as
   * `a`, and an empty alternative shows up.
   *
   * @returns {string} an approximation of the source
   */
  explain() {
    return render(this.ast);
  }

  /**
   * The compiled program, disassembled.
   *
   * @returns {string} one instruction per line
   */
  disassemble() {
    return this.program.disassemble();
  }

  /** The flag letters, in JavaScript's order. */
  get flagString() {
    return renderFlags(this.flags);
  }

  toString() {
    return `/${this.source}/${this.flagString}`;
  }
}

/** Expands a `$`-style replacement string against a match. */
function expand(replacement, found, text) {
  let out = '';
  let at = 0;

  while (at < replacement.length) {
    const dollar = replacement.indexOf('$', at);
    if (dollar < 0 || dollar === replacement.length - 1) {
      out += replacement.slice(at);
      break;
    }

    out += replacement.slice(at, dollar);
    const marker = replacement[dollar + 1];

    if (marker === '$') {
      out += '$';
      at = dollar + 2;
      continue;
    }
    if (marker === '&') {
      out += found[0];
      at = dollar + 2;
      continue;
    }
    if (marker === '`') {
      out += text.slice(0, found.index);
      at = dollar + 2;
      continue;
    }
    if (marker === "'") {
      out += text.slice(found.index + found[0].length);
      at = dollar + 2;
      continue;
    }
    if (marker === '<') {
      const close = replacement.indexOf('>', dollar + 2);
      if (close < 0) {
        out += replacement.slice(dollar);
        break;
      }
      const name = replacement.slice(dollar + 2, close);
      out += found.groups?.[name] ?? '';
      at = close + 1;
      continue;
    }

    if (marker >= '0' && marker <= '9') {
      // Two digits are preferred over one when a group that high exists,
      // so `$12` means group 12 where there are twelve groups and group 1
      // followed by "2" where there are not.
      const two = replacement.slice(dollar + 1, dollar + 3);
      if (/^\d\d$/.test(two) && Number(two) < found.length) {
        out += found[Number(two)] ?? '';
        at = dollar + 3;
        continue;
      }
      const one = Number(marker);
      if (one > 0 && one < found.length) {
        out += found[one] ?? '';
        at = dollar + 2;
        continue;
      }
    }

    out += '$';
    at = dollar + 1;
  }

  return out;
}
