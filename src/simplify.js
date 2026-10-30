/**
 * Rewrites a tree into an equivalent, smaller one.
 *
 * Every rule here has to preserve both *what* matches and *which* match wins,
 * and the second is the easy one to break. `(a|a)` and `a` match the same
 * strings, so collapsing them is safe; `(a|ab)` and `(ab|a)` match the same
 * strings and return different ones, so reordering alternatives is not.
 *
 * The rules are worth having for two reasons. They shrink the program, which
 * the VM's cost is linear in. And they make `explain` show what the engine
 * will actually do rather than what was typed, which is the difference
 * between a useful diagnostic and an echo.
 */

import {
  Kind, UNBOUNDED, alternate, charset, concat, empty, group, repeat,
} from './ast.js';

/**
 * Simplifies a tree.
 *
 * @param {object} node the root
 * @returns {object} an equivalent tree
 */
export function simplify(node) {
  switch (node.kind) {
    case Kind.CONCAT:
      return simplifyConcat(node);

    case Kind.ALTERNATE:
      return simplifyAlternate(node);

    case Kind.REPEAT:
      return simplifyRepeat(node);

    case Kind.GROUP: {
      const body = simplify(node.body);
      // A non-capturing group around a single character or another group is
      // pure noise: it emits no instructions and only makes the tree deeper.
      if (node.number < 0 && (body.kind === Kind.CHARSET || body.kind === Kind.GROUP)) {
        return body;
      }
      return group(body, node.number, node.name, node.index);
    }

    default:
      return node;
  }
}

function simplifyConcat(node) {
  const parts = [];

  for (const part of node.parts) {
    const simplified = simplify(part);

    // An empty node contributes nothing to a sequence.
    if (simplified.kind === Kind.EMPTY) continue;

    // A nested concat is flattened. `(?:ab)c` and `abc` compile identically,
    // and the flat form is what `explain` should show.
    if (simplified.kind === Kind.CONCAT) {
      parts.push(...simplified.parts);
      continue;
    }

    parts.push(simplified);
  }

  return concat(parts);
}

function simplifyAlternate(node) {
  const options = [];

  for (const option of node.options) {
    const simplified = simplify(option);

    // A nested alternation is flattened: `a|(?:b|c)` is `a|b|c`, and the
    // compiler emits a shorter split chain for the flat form.
    if (simplified.kind === Kind.ALTERNATE) {
      options.push(...simplified.options);
      continue;
    }

    options.push(simplified);
  }

  // Duplicate alternatives are dropped, keeping the first. Safe because the
  // first is the one that would have won anyway -- the VM takes branches in
  // order -- so removing the later copy changes nothing observable.
  const kept = [];
  for (const option of options) {
    if (!kept.some((existing) => sameShape(existing, option))) kept.push(option);
  }

  // A run of single-character alternatives becomes one character class.
  // `a|b|c` as three splits costs three instructions and three thread slots;
  // as `[abc]` it costs one of each.
  const merged = mergeCharsets(kept);

  return alternate(merged);
}

/** Merges adjacent single-character alternatives into one class. */
function mergeCharsets(options) {
  const out = [];
  let pending = null;

  const flush = () => {
    if (pending !== null) {
      out.push(charset(pending.set, pending.index));
      pending = null;
    }
  };

  for (const option of options) {
    if (option.kind === Kind.CHARSET) {
      // Only adjacent ones are merged. Merging across a non-charset
      // alternative would move it past something that could match first, and
      // that would change which match wins.
      pending = pending === null
        ? { set: option.set, index: option.index }
        : { set: pending.set.union(option.set), index: pending.index };
      continue;
    }
    flush();
    out.push(option);
  }

  flush();
  return out;
}

function simplifyRepeat(node) {
  const body = simplify(node.body);
  const { min, max, greedy, index } = node;

  // `x{1,1}` is `x`, and `x{0,0}` matches the empty string.
  if (min === 1 && max === 1) return body;
  if (max === 0) return empty();

  // Repeating something that matches only the empty string is the empty
  // string, however many times it is asked for.
  if (body.kind === Kind.EMPTY) return empty();

  // `(?:x*)*` is `x*`, and the nested form is what makes a backtracking
  // engine explode. This engine would survive it, but the flattening is free
  // and halves the program.
  if (body.kind === Kind.REPEAT && body.max === UNBOUNDED && max === UNBOUNDED) {
    const combinedMin = min * body.min;
    return repeat(body.body, combinedMin === 0 ? 0 : body.min, UNBOUNDED,
      greedy && body.greedy, index);
  }

  return repeat(body, min, max, greedy, index);
}

/**
 * Whether two trees have the same shape.
 *
 * Structural rather than by identity, and it ignores `index` -- two
 * alternatives written at different places in the pattern are still
 * duplicates. Capture numbers are *not* ignored: `(a)|(a)` has two groups and
 * collapsing them would lose one.
 *
 * @param {object} left a tree
 * @param {object} right another tree
 * @returns {boolean} true when they are equivalent
 */
export function sameShape(left, right) {
  if (left.kind !== right.kind) return false;

  switch (left.kind) {
    case Kind.EMPTY:
      return true;

    case Kind.CHARSET:
      return left.set.equals(right.set);

    case Kind.CONCAT:
      return left.parts.length === right.parts.length
        && left.parts.every((part, i) => sameShape(part, right.parts[i]));

    case Kind.ALTERNATE:
      return left.options.length === right.options.length
        && left.options.every((option, i) => sameShape(option, right.options[i]));

    case Kind.REPEAT:
      return left.min === right.min
        && left.max === right.max
        && left.greedy === right.greedy
        && sameShape(left.body, right.body);

    case Kind.GROUP:
      return left.number === right.number
        && left.name === right.name
        && sameShape(left.body, right.body);

    case Kind.ANCHOR:
      return left.which === right.which;

    case Kind.BOUNDARY:
      return left.negated === right.negated;

    default:
      return false;
  }
}
