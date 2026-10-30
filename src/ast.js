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

/**
 * `^` or `$`.
 *
 * @param {string} which one of {@link AnchorKind}
 * @param {number} [index] where in the pattern this came from
 */
export const anchor = (which, index = -1) => ({ kind: Kind.ANCHOR, which, index });

/**
 * `\b` or `\B`.
 *
 * @param {boolean} negated true for `\B`
 * @param {number} [index] where in the pattern this came from
 */
export const boundary = (negated, index = -1) => ({ kind: Kind.BOUNDARY, negated, index });

/**
 * Walks a tree, calling `visit` on every node, parents first.
 *
 * Iterative with an explicit stack rather than recursive: a pattern is user
 * input, and `a{1000}{1000}` nests deeply enough to overflow the call stack
 * in a tool whose job is to report problems with it.
 *
 * @param {object} node the root
 * @param {(node: object) => void} visit called once per node
 */
export function walk(node, visit) {
  const stack = [node];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    visit(current);

    if (current.parts) stack.push(...current.parts);
    if (current.options) stack.push(...current.options);
    if (current.body) stack.push(current.body);
  }
}

/**
 * How many capture groups a tree holds.
 *
 * @param {object} node the root
 * @returns {number} the highest capture number, which is the group count
 */
export function countGroups(node) {
  let highest = 0;
  walk(node, (current) => {
    if (current.kind === Kind.GROUP && current.number > highest) {
      highest = current.number;
    }
  });
  return highest;
}

/**
 * The named groups in a tree, as a map from name to number.
 *
 * @param {object} node the root
 * @returns {Map<string, number>} the names
 */
export function groupNames(node) {
  const names = new Map();
  walk(node, (current) => {
    if (current.kind === Kind.GROUP && current.name) {
      names.set(current.name, current.number);
    }
  });
  return names;
}

/**
 * Whether a node can match the empty string.
 *
 * Exported because it marks the one place this engine's behaviour departs
 * from ECMAScript, and a caller deserves a way to ask rather than guess.
 *
 * ECMAScript's repeat rule rejects an iteration that consumes nothing when
 * the lower bound is zero, which is how `/(b?)?/ ` leaves its group
 * `undefined` rather than matching empty. Implementing that would mean a
 * thread carrying the input position each iteration began at, and a thread's
 * identity would then include that position -- which breaks the one-thread-
 * per-instruction bound the linear-time guarantee rests on.
 *
 * So the trade is explicit: for any pattern where no quantifier's body is
 * nullable, this engine agrees with `RegExp` exactly. Where one is, the
 * captures of zero-width iterations may differ. `nullable` is how the test
 * suite draws that line, and how a caller can check a pattern before
 * relying on it.
 *
 * @param {object} node the root
 * @returns {boolean} true when the node can match no characters at all
 */
export function nullable(node) {
  switch (node.kind) {
    case Kind.EMPTY:
    // An anchor and a boundary consume nothing, so both match empty where
    // they hold.
    case Kind.ANCHOR:
    case Kind.BOUNDARY:
      return true;

    case Kind.CHARSET:
      return false;

    case Kind.CONCAT:
      return node.parts.every(nullable);

    case Kind.ALTERNATE:
      return node.options.some(nullable);

    case Kind.REPEAT:
      return node.min === 0 || nullable(node.body);

    case Kind.GROUP:
      return nullable(node.body);

    default:
      return true;
  }
}

/**
 * Whether any quantifier in a tree has a body that can match the empty
 * string.
 *
 * True means the pattern is outside the range where this engine and
 * `RegExp` are guaranteed to agree. See {@link nullable}.
 *
 * @param {object} node the root
 * @returns {boolean} true when some quantifier's body is nullable
 */
export function hasNullableQuantifier(node) {
  let found = false;
  walk(node, (current) => {
    if (current.kind === Kind.REPEAT && nullable(current.body)) found = true;
  });
  return found;
}

/**
 * Renders a tree back to something pattern-like, for the CLI's `explain`.
 *
 * Not guaranteed to round-trip: `a{1,1}` comes back as `a`, because the
 * simplifier has already removed it. Useful for seeing what the engine
 * actually decided to match, which is the point.
 *
 * @param {object} node the root
 * @returns {string} an approximation of the pattern
 */
export function render(node) {
  switch (node.kind) {
    case Kind.EMPTY:
      return '';

    case Kind.CHARSET:
      return node.set.toString();

    case Kind.CONCAT:
      return node.parts.map((part) => parenthesiseIf(part, Kind.ALTERNATE)).join('');

    case Kind.ALTERNATE:
      return node.options.map(render).join('|');

    case Kind.REPEAT: {
      const body = parenthesiseIf(node.body, Kind.ALTERNATE, Kind.CONCAT);
      const suffix = repeatSuffix(node);
      return `${body}${suffix}${node.greedy ? '' : '?'}`;
    }

    case Kind.GROUP: {
      if (node.number < 0) return `(?:${render(node.body)})`;
      if (node.name) return `(?<${node.name}>${render(node.body)})`;
      return `(${render(node.body)})`;
    }

    case Kind.ANCHOR:
      return node.which === AnchorKind.START ? '^' : '$';

    case Kind.BOUNDARY:
      return node.negated ? '\\B' : '\\b';

    default:
      return '?';
  }
}

function repeatSuffix(node) {
  const { min, max } = node;
  if (min === 0 && max === UNBOUNDED) return '*';
  if (min === 1 && max === UNBOUNDED) return '+';
  if (min === 0 && max === 1) return '?';
  if (max === UNBOUNDED) return `{${min},}`;
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

function parenthesiseIf(node, ...kinds) {
  const text = render(node);
  // A single character never needs brackets, whatever its kind, which keeps
  // `a*` from rendering as `(?:a)*`.
  if (node.kind === Kind.CHARSET || node.kind === Kind.GROUP) return text;
  if (kinds.includes(node.kind)) return `(?:${text})`;
  return text;
}
