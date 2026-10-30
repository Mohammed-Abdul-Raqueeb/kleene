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

