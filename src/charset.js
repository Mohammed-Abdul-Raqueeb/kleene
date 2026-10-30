/**
 * Sets of characters, as sorted lists of code-point ranges.
 *
 * Ranges rather than a bitmap or a Set, for one reason: `\w` with the
 * case-insensitive flag, or `[^\n]`, covers tens of thousands of code points.
 * A Set of those is megabytes and a bitmap over the whole Unicode range is
 * 136KB per class. A range list is four entries.
 *
 * Every set is kept normalised -- sorted, non-overlapping, non-adjacent --
 * which is what makes {@link CharSet#union} and {@link CharSet#negate} cheap
 * and {@link CharSet#equals} a plain comparison.
 */

/** The highest code point, which is where a negated set stops. */
export const MAX_CODE_POINT = 0x10ffff;

/** An immutable set of code points. */
export class CharSet {
  /**
   * @param {Array<[number, number]>} ranges inclusive pairs, already normalised
   */
  constructor(ranges) {
    this.ranges = ranges;
    // Cached because `size` is asked for in the compiler's hot path when it
    // decides whether a set is a single character worth a cheaper
    // instruction.
    this._size = null;
  }

  /**
   * A set holding exactly one code point.
   *
   * @param {number} code the code point
   * @returns {CharSet} the set
   */
  static of(code) {
    return new CharSet([[code, code]]);
  }

  /**
   * A set from one inclusive range.
   *
   * @param {number} from the first code point
   * @param {number} to the last code point
   * @returns {CharSet} the set
   */
  static range(from, to) {
    if (from > to) {
      // Caught here rather than producing an empty set, because `[z-a]` is a
      // mistake in the pattern and an empty set would silently match nothing.
      throw new RangeError(`range ${from}-${to} runs backwards`);
    }
    return new CharSet([[from, to]]);
  }

  /**
   * A set from several ranges, in any order, possibly overlapping.
   *
   * @param {Array<[number, number]>} ranges inclusive pairs
   * @returns {CharSet} the normalised set
   */
  static fromRanges(ranges) {
    return new CharSet(normalise(ranges));
  }

  /**
   * A set from the characters of a string.
   *
   * @param {string} text the characters to include
   * @returns {CharSet} the set
   */
  static fromString(text) {
    return CharSet.fromRanges([...text].map((char) => {
      const code = char.codePointAt(0);
      return [code, code];
    }));
  }

  /** The empty set, which matches nothing. */
  static empty() {
    return new CharSet([]);
  }

  /** Every code point. */
  static any() {
    return new CharSet([[0, MAX_CODE_POINT]]);
  }

  /**
   * Whether a code point is in the set.
   *
   * Binary search rather than a scan: a negated class can hold a handful of
   * ranges and this is called once per character per active thread, which is
   * the innermost loop in the whole engine.
   *
   * @param {number} code the code point to test
   * @returns {boolean} true when the set holds it
   */
  has(code) {
    let low = 0;
    let high = this.ranges.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const [from, to] = this.ranges[middle];
      if (code < from) {
        high = middle - 1;
      } else if (code > to) {
        low = middle + 1;
      } else {
        return true;
      }
    }
    return false;
  }

  /**
   * How many code points the set holds.
   *
   * @returns {number} the count
   */
  get size() {
    if (this._size === null) {
      this._size = this.ranges.reduce((total, [from, to]) => total + (to - from + 1), 0);
    }
    return this._size;
  }

  /**
   * Whether the set holds nothing.
   *
   * @returns {boolean} true when empty
   */
  get isEmpty() {
    return this.ranges.length === 0;
  }

  /**
   * The single code point this set holds, or -1.
   *
   * The compiler uses this to emit a cheaper instruction for the common case
   * of a literal character.
   *
   * @returns {number} the code point, or -1 when the set is not a singleton
   */
  get singleton() {
    if (this.ranges.length !== 1) return -1;
    const [from, to] = this.ranges[0];
    return from === to ? from : -1;
  }

  /**
   * The union of this set and another.
   *
   * @param {CharSet} other the set to merge in
   * @returns {CharSet} a new set
   */
  union(other) {
    return CharSet.fromRanges([...this.ranges, ...other.ranges]);
  }

  /**
   * The intersection of this set and another.
   *
   * @param {CharSet} other the set to intersect with
   * @returns {CharSet} a new set
   */
  intersect(other) {
    const out = [];
    let i = 0;
    let j = 0;

    // Both inputs are sorted, so this is a merge rather than a nested loop.
    while (i < this.ranges.length && j < other.ranges.length) {
      const [aFrom, aTo] = this.ranges[i];
      const [bFrom, bTo] = other.ranges[j];

      const from = Math.max(aFrom, bFrom);
      const to = Math.min(aTo, bTo);
      if (from <= to) out.push([from, to]);

      if (aTo < bTo) i++;
      else j++;
    }

    return new CharSet(out);
  }

  /**
   * This set with another removed.
   *
   * @param {CharSet} other the set to subtract
   * @returns {CharSet} a new set
   */
  subtract(other) {
    return this.intersect(other.negate());
  }

  /**
   * Every code point this set does not hold.
   *
   * @returns {CharSet} a new set
   */
  negate() {
    const out = [];
    let next = 0;

    for (const [from, to] of this.ranges) {
      if (from > next) out.push([next, from - 1]);
      next = to + 1;
    }
    if (next <= MAX_CODE_POINT) out.push([next, MAX_CODE_POINT]);

    return new CharSet(out);
  }

  /**
   * This set with both cases of every letter in it.
   *
   * Needed by the `i` flag, and done by widening the set rather than by
   * lowercasing the input: lowercasing the subject would change the offsets
   * reported for a match whenever a character's lower case is a different
   * length, which happens for a handful of real code points.
   *
   * Only simple one-to-one case pairs are handled. A full case-folding table
   * is large and the characters it adds beyond this are vanishingly rare in
   * the patterns anyone writes.
   *
   * @returns {CharSet} a new set
   */
  foldCase() {
    const extra = [];

    for (const [from, to] of this.ranges) {
      // Bounded, because a negated class spans the whole Unicode range and
      // walking it one code point at a time would take minutes. Every
      // one-to-one case pair in common use is inside the Basic Multilingual
      // Plane's first 0x300 code points, and a range that wide already covers
      // both cases of everything in it anyway.
      if (to - from > 0x300) {
        continue;
      }
      for (let code = from; code <= to; code++) {
        const char = String.fromCodePoint(code);
        const lower = char.toLowerCase();
        const upper = char.toUpperCase();

        if (lower.length === 1 && lower !== char) {
          extra.push([lower.codePointAt(0), lower.codePointAt(0)]);
        }
        if (upper.length === 1 && upper !== char) {
          extra.push([upper.codePointAt(0), upper.codePointAt(0)]);
        }
      }
    }

    return extra.length === 0 ? this : CharSet.fromRanges([...this.ranges, ...extra]);
  }

  /**
   * Whether two sets hold the same code points.
   *
   * @param {CharSet} other the set to compare with
   * @returns {boolean} true when they are equal
   */
  equals(other) {
    if (this.ranges.length !== other.ranges.length) return false;
    return this.ranges.every(([from, to], i) => (
      other.ranges[i][0] === from && other.ranges[i][1] === to
    ));
  }

  /**
   * A readable description, for the disassembler and for error messages.
   *
   * @returns {string} the set in bracket notation
   */
  toString() {
    if (this.isEmpty) return '[]';
    if (this.singleton >= 0) return describeChar(this.singleton);

    // A set covering most of Unicode is described by what it excludes, which
    // is how `[^\n]` reads as itself rather than as four enormous ranges.
    if (this.size > MAX_CODE_POINT / 2) {
      const missing = this.negate();
      return `[^${missing.ranges.map(describeRange).join('')}]`;
    }
    return `[${this.ranges.map(describeRange).join('')}]`;
  }
}

function describeRange([from, to]) {
  return from === to ? describeChar(from) : `${describeChar(from)}-${describeChar(to)}`;
}

function describeChar(code) {
  switch (code) {
    case 0x0a: return '\\n';
    case 0x0d: return '\\r';
    case 0x09: return '\\t';
    case 0x0c: return '\\f';
    case 0x0b: return '\\v';
    case 0x00: return '\\0';
    default:
      if (code < 0x20 || code > 0x7e) {
        return `\\u{${code.toString(16)}}`;
      }
      return String.fromCodePoint(code);
  }
}

/** Sorts, merges and joins adjacent ranges. */
function normalise(ranges) {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out = [sorted[0].slice()];

  for (let i = 1; i < sorted.length; i++) {
    const [from, to] = sorted[i];
    const last = out[out.length - 1];

    // `from <= last[1] + 1` rather than `<= last[1]`, so [a-m] and [n-z]
    // become one range. Adjacency matters: without it `[0-9]` built one digit
    // at a time would be ten ranges and every `has` would be slower.
    if (from <= last[1] + 1) {
      last[1] = Math.max(last[1], to);
    } else {
      out.push([from, to]);
    }
  }

  return out;
}

/** The named classes, as the parser's escapes resolve to. */
export const CLASSES = {
  d: CharSet.range(0x30, 0x39),
  w: CharSet.fromRanges([[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]]),
  // The same set JavaScript's `\s` uses, which is wider than most people
  // expect: it includes the Unicode space separators and the BOM.
  s: CharSet.fromRanges([
    [0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680],
    [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f],
    [0x3000, 0x3000], [0xfeff, 0xfeff],
  ]),
};

