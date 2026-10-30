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

test('named groups appear under their names', () => {
  const found = new Regex('(?<year>\\d{4})-(?<month>\\d{2})').match('on 2026-10-30');
  assert.equal(found.groups.year, '2026');
  assert.equal(found.groups.month, '10');
  assert.equal(found[1], '2026');
  assert.equal(found.index, 3);
});

test('groups is undefined when there are no named groups', () => {
  // What RegExp does, and callers branch on it.
  assert.equal(new Regex('(a)').match('a').groups, undefined);
});

test('the anchors hold only where they should', () => {
  matches('^a', 'ab', 'a');
  matches('^b', 'ab', null);
  matches('a$', 'ba', 'a');
  matches('b$', 'ba', null);
  matches('^ab$', 'ab', 'ab');
  matches('^$', '', '');
});

test('under multiline the anchors hold at every line', () => {
  matches('^b', 'a\nb', null);
  matches('^b', 'a\nb', 'b', 'm');
  matches('a$', 'a\nb', 'a', 'm');
  allMatches('^.', 'a\nb\nc', ['a', 'b', 'c'], 'gm');
});

test('a word boundary holds between a word and a non-word character', () => {
  matches('\\bword\\b', 'a word here', 'word');
  matches('\\bword\\b', 'wordy', null);
  matches('\\Bord', 'word', 'ord');
  matches('\\Bord', 'ord', null);
});

test('a boundary holds at the ends of the subject', () => {
  matches('\\ba', 'abc', 'a');
  matches('c\\b', 'abc', 'c');
});

test('dot matches anything but a newline, unless dotAll', () => {
  matches('a.b', 'a\nb', null);
  matches('a.b', 'a\nb', 'a\nb', 's');
  matches('a.b', 'axb', 'axb');
});

test('ignoreCase matches either case', () => {
  // The matched text comes from the subject, so it keeps the subject's case.
  matches('abc', 'ABC', 'ABC', 'i');
  matches('[a-z]+', 'ABC', 'ABC', 'i');
  matches('[^a]', 'A', null, 'i');
  matches('\\w+', 'AbC', 'AbC', 'i');
});

test('a character class matches one of its members', () => {
  matches('[abc]+', 'xbcay', 'bca');
  matches('[^a]+', 'aXYa', 'XY');
  matches('[a-c0-9]+', 'zb1c!', 'b1c');
});

test('the named classes match what they say', () => {
  matches('\\d+', 'ab123cd', '123');
  matches('\\w+', ' a_1 ', 'a_1');
  matches('\\s+', 'a \t b', ' \t ');
  matches('\\D+', '12ab34', 'ab');
});

test('code points above the BMP count as one character', () => {
  // Two things have to be right for this: the VM walks code points, and so
  // does the parser -- indexing the pattern as UTF-16 would apply the `+` to
  // half a surrogate pair, which never matches anything.
  matches('.', '\u{1f600}', '\u{1f600}');
  matches('^.$', '\u{1f600}', '\u{1f600}');
  matches('\u{1f600}+', 'a\u{1f600}\u{1f600}b', '\u{1f600}\u{1f600}');
  matches('[\u{1f600}]', '\u{1f600}', '\u{1f600}');
});

test('offsets are UTF-16 indices, as String methods report them', () => {
  // So a caller can slice the original string with what it gets back.
  const subject = '\u{1f600}ab';
  const found = new Regex('ab').match(subject);
  assert.equal(found.index, 2);
  assert.equal(subject.slice(found.index), 'ab');
  assert.equal(found.index, subject.indexOf('ab'));
});

test('matchAll yields every match without touching lastIndex', () => {
  const regex = new Regex('a', 'g');
  allMatches('a', 'aba', ['a', 'a']);
  assert.equal(regex.lastIndex, 0, 'matchAll leaves lastIndex alone');
});

