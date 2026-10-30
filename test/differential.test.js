import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Regex } from '../src/index.js';
import { hasNullableQuantifier } from '../src/ast.js';
import { renderMatch } from './helpers.js';

/**
 * Randomised differential testing against the host's own engine.
 *
 * This is the test that gives the most confidence per line in the whole
 * suite, and it is only possible because a reference implementation ships
 * with the runtime. Thousands of generated patterns are run through both
 * engines and the results compared, which finds the cases nobody would think
 * to write by hand -- two of the three real bugs in this engine were found
 * here rather than by a hand-written test.
 *
 * The generator is seeded, so a failure is reproducible: the seed is printed
 * with any mismatch.
 */

