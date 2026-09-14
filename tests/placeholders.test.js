// Unit tests for the safe `?` -> `$n` placeholder converter.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { convertPlaceholders } = require('../server/placeholders');

test('converts simple placeholders in order', () => {
  assert.deepEqual(convertPlaceholders('SELECT * FROM users WHERE a = ? AND b = ?'), {
    text: 'SELECT * FROM users WHERE a = $1 AND b = $2',
    count: 2,
  });
});

test('leaves SQL without placeholders untouched', () => {
  const sql = 'SELECT COUNT(*) AS c FROM users';
  assert.deepEqual(convertPlaceholders(sql), { text: sql, count: 0 });
});

test('ignores question marks inside single-quoted strings', () => {
  assert.deepEqual(convertPlaceholders(`SELECT * FROM t WHERE a = 'what?' AND b = ?`), {
    text: `SELECT * FROM t WHERE a = 'what?' AND b = $1`,
    count: 1,
  });
});

test('handles escaped single quotes inside strings', () => {
  assert.deepEqual(convertPlaceholders(`SELECT * FROM t WHERE a = 'it''s?' AND b = ?`), {
    text: `SELECT * FROM t WHERE a = 'it''s?' AND b = $1`,
    count: 1,
  });
});

test('handles backslash escapes inside strings', () => {
  assert.deepEqual(convertPlaceholders(`SELECT * FROM t WHERE a = 'a\\'?' AND b = ?`), {
    text: `SELECT * FROM t WHERE a = 'a\\'?' AND b = $1`,
    count: 1,
  });
});

test('ignores question marks inside double-quoted identifiers', () => {
  assert.deepEqual(convertPlaceholders('SELECT "we?ird" FROM t WHERE a = ?'), {
    text: 'SELECT "we?ird" FROM t WHERE a = $1',
    count: 1,
  });
});

test('ignores question marks inside line comments', () => {
  assert.deepEqual(convertPlaceholders('SELECT * FROM t -- really?\nWHERE a = ?'), {
    text: 'SELECT * FROM t -- really?\nWHERE a = $1',
    count: 1,
  });
});

test('ignores question marks inside block comments', () => {
  assert.deepEqual(convertPlaceholders('SELECT /* huh? */ * FROM t WHERE a = ?'), {
    text: 'SELECT /* huh? */ * FROM t WHERE a = $1',
    count: 1,
  });
});

test('ignores question marks inside dollar-quoted bodies', () => {
  assert.deepEqual(convertPlaceholders('SELECT $body$what?$body$ AS x, ? AS y'), {
    text: 'SELECT $body$what?$body$ AS x, $1 AS y',
    count: 1,
  });
  assert.deepEqual(convertPlaceholders('SELECT $$a?b$$, ?'), {
    text: 'SELECT $$a?b$$, $1',
    count: 1,
  });
});

test('does not treat minus-minus inside expressions as a comment', () => {
  // `a--1` is `a - -1`, not a comment start.
  assert.deepEqual(convertPlaceholders('SELECT ? --1'), {
    text: 'SELECT $1 --1',
    count: 1,
  });
});

test('keeps existing $n parameters and lone $ untouched', () => {
  assert.deepEqual(convertPlaceholders('SELECT $1, ?, price FROM t'), {
    text: 'SELECT $1, $1, price FROM t',
    count: 1,
  });
});

test('unterminated string consumes the rest (fail-safe: no phantom placeholders)', () => {
  assert.deepEqual(convertPlaceholders('SELECT * FROM t WHERE a = ? AND b = \'oops?'), {
    text: 'SELECT * FROM t WHERE a = $1 AND b = \'oops?',
    count: 1,
  });
});
