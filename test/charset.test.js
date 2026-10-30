import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CharSet, CLASSES, DOT_NO_NEWLINE, MAX_CODE_POINT, NEGATED_CLASSES,
} from '../src/charset.js';
import { throwsWith } from './helpers.js';

test('a singleton holds exactly one code point', () => {
  const set = CharSet.of(0x61);
  assert.ok(set.has(0x61));
  assert.ok(!set.has(0x62));
  assert.equal(set.size, 1);
  assert.equal(set.singleton, 0x61);
});

test('a range holds both ends and everything between', () => {
  const set = CharSet.range(0x61, 0x63);
  assert.ok(set.has(0x61));
  assert.ok(set.has(0x62));
  assert.ok(set.has(0x63));
  assert.ok(!set.has(0x64));
  assert.equal(set.size, 3);
  assert.equal(set.singleton, -1, 'a range of three is not a singleton');
});

test('a backwards range is refused', () => {
  // `[z-a]` is a mistake, and an empty set would silently match nothing.
  throwsWith(() => CharSet.range(0x7a, 0x61), RangeError);
});

test('the empty set holds nothing', () => {
  const set = CharSet.empty();
  assert.ok(set.isEmpty);
  assert.equal(set.size, 0);
  assert.ok(!set.has(0x61));
});

test('any holds every code point', () => {
  const set = CharSet.any();
  assert.equal(set.size, MAX_CODE_POINT + 1);
  assert.ok(set.has(0));
  assert.ok(set.has(MAX_CODE_POINT));
});

test('overlapping ranges are merged', () => {
  const set = CharSet.fromRanges([[0x61, 0x65], [0x63, 0x67]]);
  assert.equal(set.ranges.length, 1);
  assert.deepEqual(set.ranges[0], [0x61, 0x67]);
});

test('adjacent ranges are joined', () => {
  // Without joining, `[0-9]` built one digit at a time would be ten ranges
  // and every lookup would walk more of them.
  const set = CharSet.fromRanges([[0x61, 0x62], [0x63, 0x64]]);
  assert.equal(set.ranges.length, 1);
  assert.deepEqual(set.ranges[0], [0x61, 0x64]);
});

test('ranges given out of order are sorted', () => {
  const set = CharSet.fromRanges([[0x70, 0x72], [0x61, 0x63]]);
  assert.deepEqual(set.ranges, [[0x61, 0x63], [0x70, 0x72]]);
});

test('a set from a string holds its characters', () => {
  const set = CharSet.fromString('abc');
  assert.ok(set.has(0x61));
  assert.ok(set.has(0x63));
  assert.equal(set.size, 3);
});

test('a set from a string handles characters above the BMP', () => {
  const set = CharSet.fromString('\u{1f600}');
  assert.ok(set.has(0x1f600));
  assert.equal(set.size, 1);
});

test('union merges two sets', () => {
  const set = CharSet.of(0x61).union(CharSet.of(0x63));
  assert.ok(set.has(0x61));
  assert.ok(set.has(0x63));
  assert.ok(!set.has(0x62));
});

test('intersect keeps only what both hold', () => {
  const set = CharSet.range(0x61, 0x65).intersect(CharSet.range(0x63, 0x67));
  assert.deepEqual(set.ranges, [[0x63, 0x65]]);
});

test('intersecting disjoint sets gives nothing', () => {
  assert.ok(CharSet.of(0x61).intersect(CharSet.of(0x62)).isEmpty);
});

test('subtract removes one set from another', () => {
  const set = CharSet.range(0x61, 0x65).subtract(CharSet.of(0x63));
  assert.ok(set.has(0x62));
  assert.ok(!set.has(0x63));
  assert.ok(set.has(0x64));
});

test('negate holds everything the set does not', () => {
  const set = CharSet.of(0x61).negate();
  assert.ok(!set.has(0x61));
  assert.ok(set.has(0x62));
  assert.ok(set.has(0));
  assert.ok(set.has(MAX_CODE_POINT));
  assert.equal(set.size, MAX_CODE_POINT);
});

test('negating twice gives the original back', () => {
  const original = CharSet.fromRanges([[0x61, 0x63], [0x70, 0x72]]);
  assert.ok(original.negate().negate().equals(original));
});

test('negating the empty set gives everything', () => {
  assert.equal(CharSet.empty().negate().size, MAX_CODE_POINT + 1);
  assert.ok(CharSet.any().negate().isEmpty);
});

test('foldCase adds the other case of each letter', () => {
  const set = CharSet.of(0x61).foldCase();
  assert.ok(set.has(0x61), 'lower case');
  assert.ok(set.has(0x41), 'upper case');
  assert.ok(!set.has(0x62));
});

test('foldCase leaves a non-letter alone', () => {
  const set = CharSet.of(0x31).foldCase();
  assert.equal(set.size, 1);
});

test('foldCase is bounded, so a huge set does not take minutes', () => {
  // A negated class spans the whole Unicode range, and walking it one code
  // point at a time would be a million iterations per range.
  const started = performance.now();
  const set = CharSet.any().foldCase();
  const elapsed = performance.now() - started;

  assert.ok(elapsed < 500, `folding everything took ${elapsed.toFixed(0)}ms`);
  assert.ok(set.has(0x61), 'and still holds what it held');
});

test('equals compares contents, not identity', () => {
  assert.ok(CharSet.of(0x61).equals(CharSet.of(0x61)));
  assert.ok(!CharSet.of(0x61).equals(CharSet.of(0x62)));
  // Two sets built differently that hold the same thing are equal, which the
  // normalisation is what guarantees.
  assert.ok(
    CharSet.fromRanges([[0x61, 0x61], [0x62, 0x62]]).equals(CharSet.range(0x61, 0x62)),
  );
});

