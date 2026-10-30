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

