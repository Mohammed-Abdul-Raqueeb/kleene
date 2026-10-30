import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Kind, render } from '../src/ast.js';
import { PatternError, UnsupportedError } from '../src/errors.js';
import { MAX_DEPTH, MAX_REPEAT, parse } from '../src/parser.js';
import { throwsWith } from './helpers.js';

/** Parses a pattern and returns the tree. */
const tree = (pattern, flags = {}) => parse(pattern, flags).node;

test('a literal is a one-character set', () => {
  const node = tree('a');
  assert.equal(node.kind, Kind.CHARSET);
  assert.equal(node.set.singleton, 0x61);
});

test('a sequence is a concat', () => {
  const node = tree('abc');
  assert.equal(node.kind, Kind.CONCAT);
  assert.equal(node.parts.length, 3);
});

test('an empty pattern parses to Empty rather than failing', () => {
  // `new RegExp('')` is legal and matches the empty string, so this is too.
  assert.equal(tree('').kind, Kind.EMPTY);
});

test('alternation splits at the top level', () => {
  const node = tree('ab|cd');
  assert.equal(node.kind, Kind.ALTERNATE);
  assert.equal(node.options.length, 2);
  assert.equal(node.options[0].kind, Kind.CONCAT);
});

test('an empty alternative is allowed', () => {
  // `a|` matches "a" or nothing, which is legal and occasionally meant.
  const node = tree('a|');
  assert.equal(node.options.length, 2);
  assert.equal(node.options[1].kind, Kind.EMPTY);
});

test('the three shorthand quantifiers map onto bounds', () => {
  assert.deepEqual(pick(tree('a*')), { min: 0, max: Infinity, greedy: true });
  assert.deepEqual(pick(tree('a+')), { min: 1, max: Infinity, greedy: true });
  assert.deepEqual(pick(tree('a?')), { min: 0, max: 1, greedy: true });
});

test('a trailing question mark makes a quantifier lazy', () => {
  assert.equal(pick(tree('a*?')).greedy, false);
  assert.equal(pick(tree('a+?')).greedy, false);
  assert.equal(pick(tree('a??')).greedy, false);
  assert.equal(pick(tree('a{1,2}?')).greedy, false);
});

