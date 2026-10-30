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

