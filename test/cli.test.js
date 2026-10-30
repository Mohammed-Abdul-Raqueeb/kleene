import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, run } from '../src/cli.js';
import { throwsWith } from './helpers.js';

/** Collects what a stream was written. */
function sink() {
  const chunks = [];
  return {
    write(text) { chunks.push(text); return true; },
    get text() { return chunks.join(''); },
  };
}

