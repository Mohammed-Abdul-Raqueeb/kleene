import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Kind, render } from '../src/ast.js';
import { PatternError, UnsupportedError } from '../src/errors.js';
import { MAX_DEPTH, MAX_REPEAT, parse } from '../src/parser.js';
import { throwsWith } from './helpers.js';

/** Parses a pattern and returns the tree. */
const tree = (pattern, flags = {}) => parse(pattern, flags).node;

