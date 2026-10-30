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

