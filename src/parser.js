/**
 * Turns a pattern into a tree.
 *
 * Recursive descent over three levels, which is all the grammar has:
 *
 *   alternation := concat ('|' concat)*
 *   concat      := repeat*
 *   repeat      := atom ('*' | '+' | '?' | '{n,m}')* '?'?
 *   atom        := char | '.' | '[' class ']' | '(' alternation ')' | escape | anchor
 *
 * The one place it is not a clean recursion is the postfix quantifiers, which
 * loop so that `a**` is a parse error rather than a nested repetition --
 * `(a*)*` is what someone writing that almost certainly did not mean, and an
 * error is better than silently compiling something exponential.
 */

import * as A from './ast.js';
import {
  CharSet, CLASSES, DOT_NO_NEWLINE, NEGATED_CLASSES,
} from './charset.js';
import { PatternError, UnsupportedError } from './errors.js';

/** The most repetitions `{n,m}` may ask for. */
export const MAX_REPEAT = 10000;

/** How deeply groups may nest. */
export const MAX_DEPTH = 100;

/**
 * Parses a pattern.
 *
 * @param {string} pattern the pattern text
 * @param {object} [flags] the parsed flags; only `dotAll` and `ignoreCase`
 *     affect parsing
 * @returns {{node: object, groupCount: number, names: Map<string, number>}}
 *     the tree and what it captures
 * @throws {PatternError} when the pattern is not valid
 */
export function parse(pattern, flags = {}) {
  // Checked here rather than only in the Regex constructor, because `parse`
  // is exported and a caller reaching it directly deserves the same error
  // everything else in this library raises -- not a TypeError from inside
  // the scanner about reading a property of null.
  if (typeof pattern !== 'string') {
    throw new PatternError(
      `a pattern must be a string, got ${pattern === null ? 'null' : typeof pattern}`,
      { pattern: '', index: -1 },
    );
  }

  const parser = new Parser(pattern, flags);
  const node = parser.parseAlternation();

  if (!parser.atEnd) {
    // The only character that can stop the top-level parse without being
    // consumed is an unmatched ')'.
    parser.fail(`unmatched ')'`);
  }

  return {
    node,
    groupCount: parser.groupCount,
    names: parser.names,
  };
}

class Parser {
  constructor(pattern, flags) {
    this.pattern = pattern;
    // Scanned as code points, not UTF-16 units. Indexing the string directly
    // splits an astral character into a surrogate pair, so a pattern like
    // /😀+/ would apply the + to the low half and never match -- the
    // VM works in code points, and a lone high surrogate is not one of them.
    this.chars = [...pattern];
    this.flags = flags;
    this.at = 0;
    this.groupCount = 0;
    this.names = new Map();
    this.depth = 0;
  }

  get atEnd() {
    return this.at >= this.chars.length;
  }

  peek(ahead = 0) {
    return this.chars[this.at + ahead];
  }

  next() {
    return this.chars[this.at++];
  }

  /** The scanned text from `from` up to but not including `to`. */
  slice(from, to) {
    return this.chars.slice(from, to).join('');
  }

  /**
   * The UTF-16 offset of a code-point index.
   *
   * Error messages point into the pattern as the user typed it, so the caret
   * has to be placed in UTF-16 terms even though scanning is not.
   */
  utf16Index(at) {
    return this.chars.slice(0, at).join('').length;
  }

  eat(char) {
    if (this.peek() === char) {
      this.at++;
      return true;
    }
    return false;
  }

  fail(message, index = this.at) {
    throw new PatternError(message, { pattern: this.pattern, index: this.utf16Index(index) });
  }

  unsupported(message, index = this.at) {
    throw new UnsupportedError(message, { pattern: this.pattern, index: this.utf16Index(index) });
  }

  parseAlternation() {
    const options = [this.parseConcat()];
    while (this.eat('|')) {
      options.push(this.parseConcat());
    }
    return A.alternate(options);
  }

  parseConcat() {
    const parts = [];

    while (!this.atEnd && this.peek() !== '|' && this.peek() !== ')') {
      parts.push(this.parseRepeat());
    }

    return A.concat(parts);
  }

  parseRepeat() {
    const start = this.at;
    const atom = this.parseAtom();
    let node = atom;
    let applied = false;

    while (!this.atEnd) {
      const char = this.peek();
      let min;
      let max;

      if (char === '*') {
        this.at++;
        min = 0;
        max = A.UNBOUNDED;
      } else if (char === '+') {
        this.at++;
        min = 1;
        max = A.UNBOUNDED;
      } else if (char === '?') {
        this.at++;
        min = 0;
        max = 1;
      } else if (char === '{') {
        const bounds = this.tryParseBounds();
        if (bounds === null) break;
        ({ min, max } = bounds);
      } else {
        break;
      }

      if (applied) {
        // `a**` and `a*+` are rejected rather than nested. A nested
        // unbounded repeat is the shape that makes a backtracking engine
        // blow up, and while this engine would survive it, accepting it
        // would mean quietly compiling something the author did not write.
        this.fail(
          `'${char}' cannot follow another quantifier; `
            + 'wrap the first in a group if that is what you meant',
          this.at - 1,
        );
      }

      if (!canRepeat(atom)) {
        this.fail('nothing to repeat', start);
      }

      const greedy = !this.eat('?');
      node = A.repeat(node, min, max, greedy, start);
      applied = true;
    }

    return node;
  }

  /**
   * Reads `{n}`, `{n,}` or `{n,m}`.
   *
   * Returns null rather than failing when the braces do not hold a bound,
   * because `a{` and `a{x}` are literal braces in every engine that matters
   * and refusing them would reject patterns that work elsewhere.
   */
  tryParseBounds() {
    const start = this.at;
    let cursor = this.at + 1;

    const digitsFrom = (from) => {
      let to = from;
      while (to < this.chars.length && this.chars[to] >= '0' && this.chars[to] <= '9') {
        to++;
      }
      return to;
    };

    const minEnd = digitsFrom(cursor);
    if (minEnd === cursor) return null;
    const min = Number(this.slice(cursor, minEnd));
    cursor = minEnd;

    let max = min;
    if (this.chars[cursor] === ',') {
      cursor++;
      const maxEnd = digitsFrom(cursor);
      if (maxEnd === cursor) {
        max = A.UNBOUNDED;
      } else {
        max = Number(this.slice(cursor, maxEnd));
        cursor = maxEnd;
      }
    }

    if (this.chars[cursor] !== '}') return null;
    cursor++;

    if (min > max) {
      this.fail(`{${min},${max}} counts down; the first bound must not exceed the second`, start);
    }
    if (max !== A.UNBOUNDED && max > MAX_REPEAT) {
      // Bounded because `a{1,1000000}` compiles to a program with a million
      // instructions. The limit is reported rather than the engine running
      // out of memory an unpredictable time later.
      this.fail(
        `{${min},${max}} would expand to more than ${MAX_REPEAT} copies`,
        start,
      );
    }

    this.at = cursor;
    return { min, max };
  }

  parseAtom() {
    const start = this.at;
    const char = this.next();

    switch (char) {
      case undefined:
        this.fail('unexpected end of pattern', start);
        return null;

      case '(':
        return this.parseGroup(start);

      case '[':
        return A.charset(this.parseClass(start), start);

      case '.':
        return A.charset(
          this.flags.dotAll ? CharSet.any() : DOT_NO_NEWLINE,
          start,
        );

      case '^':
        return A.anchor(A.AnchorKind.START, start);

      case '$':
        return A.anchor(A.AnchorKind.END, start);

      case '\\':
        return this.parseEscape(start);

      case '*':
      case '+':
      case '?':
        this.fail('nothing to repeat', start);
        return null;

      case ')':
        this.fail(`unmatched ')'`, start);
        return null;

      default:
        return A.charset(this.literal(char), start);
    }
  }

  /** A single character as a set, widened when matching case-insensitively. */
  literal(char) {
    const set = CharSet.of(char.codePointAt(0));
    return this.flags.ignoreCase ? set.foldCase() : set;
  }

  parseGroup(start) {
    this.depth++;
    if (this.depth > MAX_DEPTH) {
      this.fail(`groups nest more than ${MAX_DEPTH} deep`, start);
    }

    try {
      let number = -1;
      let name = null;

      if (this.eat('?')) {
        const marker = this.next();

        if (marker === ':') {
          // Non-capturing. Nothing more to read.
        } else if (marker === '<') {
          // `(?<name>` is a named group; `(?<=` and `(?<!` are lookbehind,
          // which this engine does not do. Told apart by the next character.
          if (this.peek() === '=' || this.peek() === '!') {
            this.unsupported(
              'lookbehind is not supported: it cannot be expressed as a finite '
                + 'automaton, which is what this engine builds',
              start,
            );
          }
          name = this.parseGroupName(start);
          this.groupCount++;
          number = this.groupCount;
        } else if (marker === '=' || marker === '!') {
          this.unsupported(
            'lookahead is not supported: it cannot be expressed as a finite '
              + 'automaton, which is what this engine builds',
            start,
          );
        } else {
          this.fail(
            `'(?${marker ?? ''}' is not a recognised group; `
              + `use (?: for a non-capturing group or (?<name> for a named one`,
            start,
          );
        }
      } else {
        this.groupCount++;
        number = this.groupCount;
      }

      const body = this.parseAlternation();
      if (!this.eat(')')) {
        this.fail(`unterminated group: expected ')'`, start);
      }

      return A.group(body, number, name, start);
    } finally {
      this.depth--;
    }
  }

  parseGroupName(start) {
    let name = '';
    while (!this.atEnd && this.peek() !== '>') {
      name += this.next();
    }
    if (!this.eat('>')) {
      this.fail(`unterminated group name: expected '>'`, start);
    }
    if (name === '') {
      this.fail('a group name cannot be empty', start);
    }
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      this.fail(
        `'${name}' is not a usable group name; use letters, digits and underscores, `
          + 'starting with a letter',
        start,
      );
    }
    if (this.names.has(name)) {
      // Duplicate names would make `groups.foo` ambiguous, and silently
      // keeping one of them is worse than refusing.
      this.fail(`the group name '${name}' is used twice`, start);
    }
    this.names.set(name, this.groupCount + 1);
    return name;
  }

  /** Reads a `[...]` class, after the opening bracket. */
  parseClass(start) {
    const negated = this.eat('^');
    const ranges = [];
    let set = CharSet.empty();
    let first = true;

    while (true) {
      if (this.atEnd) {
        this.fail(`unterminated character class: expected ']'`, start);
      }

      // `]` as the first character is a literal, which is what POSIX does
      // and what `[]]` relies on.
      if (this.peek() === ']' && !first) {
        this.at++;
        break;
      }
      first = false;

      const low = this.parseClassMember();

      // A named class such as `\d` cannot be an endpoint of a range: `[\d-z]`
      // has no meaning, and treating the dash as a literal is what every
      // other engine does.
      if (low.set) {
        set = set.union(low.set);
        continue;
      }

      if (this.peek() === '-' && this.peek(1) !== ']' && this.at + 1 < this.pattern.length) {
        this.at++;
        const high = this.parseClassMember();
        if (high.set) {
          // `[a-\d]` -- the dash is literal and the class joins.
          ranges.push([low.code, low.code]);
          ranges.push([0x2d, 0x2d]);
          set = set.union(high.set);
          continue;
        }
        if (low.code > high.code) {
          this.fail(
            `[${String.fromCodePoint(low.code)}-${String.fromCodePoint(high.code)}] `
              + 'runs backwards',
            start,
          );
        }
        ranges.push([low.code, high.code]);
        continue;
      }

      ranges.push([low.code, low.code]);
    }

    let result = set.union(CharSet.fromRanges(ranges));

    // Case folding happens before negation. `[^a]` with the `i` flag must
    // exclude both `a` and `A`, and folding after negating would add `A`
    // back in.
    if (this.flags.ignoreCase) result = result.foldCase();
    if (negated) result = result.negate();

    if (result.isEmpty) {
      this.fail('this character class matches nothing', start);
    }
    return result;
  }

  /**
   * One member of a class: a character or a named class.
   *
   * @returns {{code: number}|{set: CharSet}} a code point, or a whole set
   */
  parseClassMember() {
    const char = this.next();

    if (char !== '\\') {
      return { code: char.codePointAt(0) };
    }

    const escape = this.next();
    if (escape === undefined) {
      this.fail('pattern ends with a backslash', this.at);
    }

    if (CLASSES[escape]) return { set: CLASSES[escape] };
    if (NEGATED_CLASSES[escape]) return { set: NEGATED_CLASSES[escape] };

    // `\b` inside a class is a backspace, not a word boundary. A genuine
    // quirk of the syntax, and one every engine shares.
    if (escape === 'b') return { code: 0x08 };

    return { code: this.resolveSimpleEscape(escape) };
  }

  parseEscape(start) {
    const escape = this.next();
    if (escape === undefined) {
      this.fail('pattern ends with a backslash', start);
    }

    if (CLASSES[escape]) {
      return A.charset(CLASSES[escape], start);
    }
    if (NEGATED_CLASSES[escape]) {
      return A.charset(NEGATED_CLASSES[escape], start);
    }

    if (escape === 'b') return A.boundary(false, start);
    if (escape === 'B') return A.boundary(true, start);

    if (escape >= '1' && escape <= '9') {
      this.unsupported(
        'backreferences are not supported: matching them is NP-hard in general, '
          + 'and this engine promises linear time',
        start,
      );
    }

    if (escape === 'k') {
      this.unsupported(
        'named backreferences are not supported, for the same reason as numbered ones',
        start,
      );
    }

    return A.charset(this.literalCode(this.resolveSimpleEscape(escape)), start);
  }

  literalCode(code) {
    const set = CharSet.of(code);
    return this.flags.ignoreCase ? set.foldCase() : set;
  }

  /** The escapes that stand for one character. */
  resolveSimpleEscape(escape) {
    switch (escape) {
      case 'n': return 0x0a;
      case 'r': return 0x0d;
      case 't': return 0x09;
      case 'f': return 0x0c;
      case 'v': return 0x0b;
      case '0': return 0x00;
      case 'x': return this.readHex(2);
      case 'u': return this.readUnicode();
      case 'c': return this.readControl();
      default:
        if (/[A-Za-z0-9]/.test(escape)) {
          // An unknown alphanumeric escape is refused rather than treated as
          // the bare letter. `\q` is almost always a typo for something, and
          // silently matching `q` hides it.
          this.fail(
            `'\\${escape}' is not a recognised escape`,
            this.at - 2,
          );
        }
        return escape.codePointAt(0);
    }
  }

  readHex(digits) {
    const text = this.slice(this.at, this.at + digits);
    if (text.length !== digits || !/^[0-9a-fA-F]+$/.test(text)) {
      this.fail(`\\x needs ${digits} hex digits`, this.at - 2);
    }
    this.at += digits;
    return parseInt(text, 16);
  }

  readUnicode() {
    // `\u{1f600}` and `é` are both accepted. The braced form is the only
    // way to name a code point above the BMP in one escape.
    if (this.eat('{')) {
      let text = '';
      while (!this.atEnd && this.peek() !== '}') text += this.next();
      if (!this.eat('}')) {
        this.fail('unterminated \\u{...} escape', this.at);
      }
      if (!/^[0-9a-fA-F]+$/.test(text)) {
        this.fail('\\u{...} needs hex digits', this.at);
      }
      const code = parseInt(text, 16);
      if (code > 0x10ffff) {
        this.fail(`\\u{${text}} is above the highest code point`, this.at);
      }
      return code;
    }
    return this.readHex(4);
  }

  readControl() {
    const letter = this.next();
    if (letter === undefined || !/[A-Za-z]/.test(letter)) {
      this.fail('\\c needs a letter', this.at - 2);
    }
    return letter.toUpperCase().charCodeAt(0) - 64;
  }
}

/** Whether a node can carry a quantifier. */
function canRepeat(node) {
  // An anchor or a boundary cannot: `^*` has no meaning, and every engine
  // either errors or quietly ignores it. Erroring is the honest option.
  return node.kind !== A.Kind.ANCHOR && node.kind !== A.Kind.BOUNDARY;
}
