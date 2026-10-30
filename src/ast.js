/**
 * The shapes a parsed pattern can take.
 *
 * Plain tagged objects rather than classes. The compiler is one switch over
 * the tag, and the nodes carry no behaviour -- only structure -- so classes
 * would spread that switch across a dozen files for nothing.
 */

/** Node type tags. */
export const Kind = {
  EMPTY: 'Empty',
  CHARSET: 'CharSet',
  CONCAT: 'Concat',
  ALTERNATE: 'Alternate',
  REPEAT: 'Repeat',
  GROUP: 'Group',
  ANCHOR: 'Anchor',
  BOUNDARY: 'Boundary',
};

/** What an anchor anchors to. */
export const AnchorKind = {
  START: 'start',
  END: 'end',
};

/** Matches the empty string. The identity of concatenation. */
export const empty = () => ({ kind: Kind.EMPTY });

/**
 * Matches one character from a set.
 *
 * @param {import('./charset.js').CharSet} set the characters accepted
 * @param {number} [index] where in the pattern this came from
 */
export const charset = (set, index = -1) => ({ kind: Kind.CHARSET, set, index });

/**
 * One node after another.
 *
 * @param {object[]} parts the nodes, in order
 */
export const concat = (parts) => {
  if (parts.length === 0) return empty();
  if (parts.length === 1) return parts[0];
  return { kind: Kind.CONCAT, parts };
};

/**
 * One node or another.
 *
 * @param {object[]} options the alternatives, in order
 */
export const alternate = (options) => {
  if (options.length === 1) return options[0];
  return { kind: Kind.ALTERNATE, options };
};

/**
 * A node repeated between `min` and `max` times.
 *
 * `max` of {@link UNBOUNDED} means no limit, which is what `*`, `+` and
 * `{n,}` all compile to.
 *
 * `greedy` decides which branch the compiler puts first, and that is the
 * whole of greediness -- the Pike VM takes threads in order and the first to
 * reach the end wins, so ordering the branches orders the preferences.
 *
 * @param {object} body what is repeated
 * @param {number} min the least number of repetitions
 * @param {number} max the most, or UNBOUNDED
 * @param {boolean} greedy whether to prefer more over fewer
 * @param {number} [index] where in the pattern this came from
 */
export const repeat = (body, min, max, greedy, index = -1) => ({
  kind: Kind.REPEAT, body, min, max, greedy, index,
});

/** `max` for a repetition with no upper limit. */
export const UNBOUNDED = Infinity;

/**
 * A group, capturing or not.
 *
 * @param {object} body what is grouped
 * @param {number} number the capture number, or -1 when not capturing
 * @param {string|null} name the group's name, or null
 * @param {number} [index] where in the pattern this came from
 */
export const group = (body, number, name = null, index = -1) => ({
  kind: Kind.GROUP, body, number, name, index,
});

