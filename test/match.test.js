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

