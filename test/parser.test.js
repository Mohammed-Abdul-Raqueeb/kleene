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

test('unbalanced parentheses are reported from the right end', () => {
  const open = throwsWith(() => tree('(a'), PatternError);
  assert.match(open.message, /unterminated group/);

  const close = throwsWith(() => tree('a)'), PatternError);
  assert.match(close.message, /unmatched/);
});

test('character classes parse ranges, lists and negation', () => {
  assert.ok(tree('[abc]').set.has(0x62));
  assert.ok(tree('[a-c]').set.has(0x62));
  assert.ok(!tree('[a-c]').set.has(0x64));
  assert.ok(!tree('[^a]').set.has(0x61));
  assert.ok(tree('[^a]').set.has(0x62));
});

test('a close bracket first in a class is literal', () => {
  // What POSIX does, and what `[]]` relies on.
  assert.ok(tree('[]]').set.has(0x5d));
  assert.ok(tree('[^]]').set.has(0x61));
});

test('a dash at either end of a class is literal', () => {
  assert.ok(tree('[-a]').set.has(0x2d));
  assert.ok(tree('[a-]').set.has(0x2d));
});

test('a named class inside a class joins it', () => {
  const set = tree('[\\d-]').set;
  assert.ok(set.has(0x35), 'digits');
  assert.ok(set.has(0x2d), 'the literal dash');
});

test('a descending class range is rejected', () => {
  const error = throwsWith(() => tree('[z-a]'), PatternError);
  assert.match(error.message, /runs backwards/);
});

test('an unterminated class is rejected', () => {
  const error = throwsWith(() => tree('[abc'), PatternError);
  assert.match(error.message, /unterminated character class/);
});

test('a class that matches nothing is rejected', () => {
  // `[^\s\S]` can never match, and a pattern that silently never matches is
  // worse than one that will not compile.
  const error = throwsWith(() => tree('[^\\s\\S]'), PatternError);
  assert.match(error.message, /matches nothing/);
});

test('the named classes resolve to the right sets', () => {
  assert.ok(tree('\\d').set.has(0x35));
  assert.ok(!tree('\\d').set.has(0x61));
  assert.ok(tree('\\w').set.has(0x5f));
  assert.ok(tree('\\s').set.has(0x20));
  assert.ok(tree('\\D').set.has(0x61));
  assert.ok(!tree('\\D').set.has(0x35));
  assert.ok(tree('\\W').set.has(0x20));
  assert.ok(tree('\\S').set.has(0x61));
});

test('escapes for control characters resolve', () => {
  assert.equal(tree('\\n').set.singleton, 0x0a);
  assert.equal(tree('\\t').set.singleton, 0x09);
  assert.equal(tree('\\r').set.singleton, 0x0d);
  assert.equal(tree('\\f').set.singleton, 0x0c);
  assert.equal(tree('\\v').set.singleton, 0x0b);
  assert.equal(tree('\\0').set.singleton, 0x00);
  assert.equal(tree('\\x41').set.singleton, 0x41);
  assert.equal(tree('\\u00e9').set.singleton, 0xe9);
  assert.equal(tree('\\u{1f600}').set.singleton, 0x1f600);
  assert.equal(tree('\\cA').set.singleton, 1);
});

