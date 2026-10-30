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

test('braced bounds parse in all three forms', () => {
  assert.deepEqual(pick(tree('a{3}')), { min: 3, max: 3, greedy: true });
  assert.deepEqual(pick(tree('a{2,}')), { min: 2, max: Infinity, greedy: true });
  assert.deepEqual(pick(tree('a{1,4}')), { min: 1, max: 4, greedy: true });
});

test('braces that are not bounds are literal', () => {
  // `a{` and `a{x}` are literal braces in every engine that matters, and
  // refusing them would reject patterns that work elsewhere.
  assert.equal(render(tree('a{')), 'a{');
  assert.equal(render(tree('a{x}')), 'a{x}');
  assert.equal(render(tree('a{,2}')), 'a{,2}');
});

test('descending bounds are rejected', () => {
  const error = throwsWith(() => tree('a{3,1}'), PatternError);
  assert.match(error.message, /counts down/);
});

test('an enormous bound is rejected rather than compiled', () => {
  const error = throwsWith(() => tree(`a{1,${MAX_REPEAT + 1}}`), PatternError);
  assert.match(error.message, new RegExp(String(MAX_REPEAT)));
});

test('a quantifier with nothing to repeat is rejected', () => {
  throwsWith(() => tree('*a'), PatternError);
  throwsWith(() => tree('+'), PatternError);
  throwsWith(() => tree('?'), PatternError);
  // An anchor cannot carry one either: `^*` has no meaning.
  throwsWith(() => tree('^*'), PatternError);
  throwsWith(() => tree('\\b*'), PatternError);
});

test('stacked quantifiers are rejected, not nested', () => {
  // `a**` is the shape that makes a backtracking engine explode. This engine
  // would survive it, but accepting it would mean compiling something the
  // author did not write.
  const error = throwsWith(() => tree('a**'), PatternError);
  assert.match(error.message, /cannot follow another quantifier/);
  assert.match(error.message, /wrap the first in a group/);

  throwsWith(() => tree('a+*'), PatternError);
  throwsWith(() => tree('a{2}{3}'), PatternError);
  // The grouped form is the way to say it, and is accepted.
  assert.equal(tree('(?:a*)*').kind, Kind.REPEAT);
});

test('groups capture unless marked otherwise', () => {
  assert.equal(parse('(a)').groupCount, 1);
  assert.equal(parse('(?:a)').groupCount, 0);
  assert.equal(parse('(a)(b)(c)').groupCount, 3);
  assert.equal(parse('(a(b))').groupCount, 2);
});

test('named groups record their names and numbers', () => {
  const parsed = parse('(?<first>a)(?<second>b)');
  assert.equal(parsed.groupCount, 2);
  assert.deepEqual([...parsed.names], [['first', 1], ['second', 2]]);
});

test('a duplicate group name is rejected', () => {
  // Two groups of one name would make `groups.x` ambiguous, and silently
  // keeping one is worse than refusing.
  const error = throwsWith(() => parse('(?<x>a)(?<x>b)'), PatternError);
  assert.match(error.message, /used twice/);
});

test('an unusable group name is rejected, quoting it', () => {
  throwsWith(() => parse('(?<>a)'), PatternError);
  const error = throwsWith(() => parse('(?<1a>b)'), PatternError);
  assert.match(error.message, /1a/);
});

test('an unrecognised group marker is rejected with the alternatives', () => {
  const error = throwsWith(() => parse('(?#comment)'), PatternError);
  assert.match(error.message, /\(\?:/);
  assert.match(error.message, /\(\?<name>/);
});

