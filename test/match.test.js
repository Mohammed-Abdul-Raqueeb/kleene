import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { agreesWithRegExp, allMatches, captures, matches } from './helpers.js';

test('a literal matches where it occurs', () => {
  matches('abc', 'xxabcyy', 'abc');
  matches('abc', 'xxabyy', null);
  matches('a', 'a', 'a');
});

test('the empty pattern matches at the start', () => {
  const found = new Regex('').match('abc');
  assert.equal(found[0], '');
  assert.equal(found.index, 0);
});

test('a search finds the leftmost match', () => {
  const found = new Regex('a').match('bbab');
  assert.equal(found.index, 2);
});

test('the leftmost match wins over a longer one further right', () => {
  // Leftmost-first, as Perl and JavaScript do. A POSIX engine would prefer
  // the longest, and the difference is visible here.
  matches('a|ab', 'xab', 'a');
});

test('alternation prefers the earlier branch', () => {
  matches('ab|a', 'ab', 'ab');
  matches('a|ab', 'ab', 'a');
});

test('star, plus and optional match the obvious things', () => {
  matches('a*', 'aaa', 'aaa');
  matches('a*', 'bbb', '');
  matches('a+', 'baaa', 'aaa');
  matches('a+', 'bbb', null);
  matches('ab?c', 'ac', 'ac');
  matches('ab?c', 'abc', 'abc');
});

test('greedy quantifiers take as much as they can', () => {
  matches('a.*b', 'axbxb', 'axbxb');
  matches('<.+>', '<a><b>', '<a><b>');
});

test('lazy quantifiers take as little as they can', () => {
  // The difference the trailing `?` makes, and the reason it exists.
  matches('a.*?b', 'axbxb', 'axb');
  matches('<.+?>', '<a><b>', '<a>');
  matches('a??', 'a', '');
});

test('bounded repeats honour both ends', () => {
  matches('a{2}', 'aaa', 'aa');
  matches('a{2}', 'a', null);
  matches('a{2,}', 'aaaa', 'aaaa');
  matches('a{2,3}', 'aaaa', 'aaa');
  matches('a{0,2}', 'bbb', '');
});

test('capture groups record what they matched', () => {
  captures('(a)(b)', 'ab', ['ab', 'a', 'b']);
  captures('(a(b))', 'ab', ['ab', 'ab', 'b']);
  captures('(?:a)(b)', 'ab', ['ab', 'b']);
});

test('a group that did not participate reads as undefined', () => {
  // Not an empty string: the distinction is what `(a)|(b)` depends on.
  captures('(a)|(b)', 'b', ['b', undefined, 'b']);
  captures('x(y)?z', 'xz', ['xz', undefined]);
});

test('a quantified group clears its captures on each iteration', () => {
  // ECMAScript's rule, and one this engine had to be taught: the first pass
  // of `(?:(a)|(b))+` sets group 1, and the second pass must unset it again
  // rather than leaving the stale 'a' behind.
  captures('(?:(a)|(b))+', 'ab', ['ab', undefined, 'b']);
  captures('(a)+', 'aaa', ['aaa', 'a']);
  captures('(?:(a)(x)?)+', 'aa', ['aa', 'a', undefined]);
});

