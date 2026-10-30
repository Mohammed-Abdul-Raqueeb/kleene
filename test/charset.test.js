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

