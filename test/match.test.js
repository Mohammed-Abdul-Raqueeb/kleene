import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { agreesWithRegExp, allMatches, captures, matches } from './helpers.js';

test('a literal matches where it occurs', () => {
  matches('abc', 'xxabcyy', 'abc');
  matches('abc', 'xxabyy', null);
  matches('a', 'a', 'a');
});

