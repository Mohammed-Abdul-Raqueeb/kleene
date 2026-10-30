/**
 * Shared test helpers.
 *
 * Two things, both to do with what `node:assert` does not give you:
 * `assert.throws` checks that something threw and returns nothing, so
 * asserting on a message means catching by hand; and almost every test in
 * this suite wants to compare against `RegExp`, which deserves one function
 * rather than being spelled out each time.
 */

import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { hasNullableQuantifier } from '../src/ast.js';

