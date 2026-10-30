/**
 * Parse failures, with the position they happened at.
 *
 * A pattern is written as one line of dense punctuation, and the only
 * feedback a user gets is what the error says. "invalid regular expression"
 * sends them back to count brackets; a caret under the offending character
 * does not.
 */

/** A pattern that could not be parsed. */
export class PatternError extends SyntaxError {
  /**
   * @param {string} message what is wrong, as a sentence
   * @param {object} [options]
   * @param {string} [options.pattern] the pattern being parsed
   * @param {number} [options.index] the character the problem is at
   */
  constructor(message, { pattern = '', index = -1 } = {}) {
    super(message);
    this.name = 'PatternError';
    this.pattern = pattern;
    this.index = index;
  }

  /**
   * The message with the pattern and a caret beneath the problem.
   *
   * @returns {string} two or three lines, ready to print
   */
  format() {
    if (this.index < 0 || !this.pattern) {
      return `${this.name}: ${this.message}`;
    }

    // Clamped, because "unexpected end of pattern" naturally reports an index
    // one past the last character and the caret still has to land somewhere.
    const at = Math.min(this.index, this.pattern.length);
    return [
      `${this.name}: ${this.message}`,
      `  /${this.pattern}/`,
      `   ${' '.repeat(at)}^`,
    ].join('\n');
  }
}

/**
 * A pattern this engine deliberately does not support.
 *
 * Separate from {@link PatternError} because the two mean different things to
 * the user. A parse error is a mistake in the pattern; this is a pattern that
 * is perfectly valid elsewhere and will never work here. Telling them apart
 * is the difference between "fix your typo" and "use a different tool".
 */
export class UnsupportedError extends PatternError {
  /**
   * @param {string} message what is unsupported, and why
   * @param {object} [options] see {@link PatternError}
   */
  constructor(message, options) {
    super(message, options);
    this.name = 'UnsupportedError';
  }
}

/**
 * Something went wrong at match time rather than at parse time.
 *
 * Rare by design: almost everything that can go wrong is caught while
 * parsing. What is left is a limit being hit, such as a program larger than
 * the engine will build.
 */
export class MatchError extends Error {
  /**
   * @param {string} message what went wrong
   */
  constructor(message) {
    super(message);
    this.name = 'MatchError';
  }
}
