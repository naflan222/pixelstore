// Safe `?` -> `$n` placeholder converter for PostgreSQL.
//
// Route code keeps writing portable SQL with `?` placeholders (which SQLite
// executes natively). The PostgreSQL driver layer converts them to `$1, $2…`
// through THIS tokenizer — never through a blind string replace — so a `?`
// inside a string literal, quoted identifier, comment, or dollar-quoted body
// is left untouched.
//
// Recognised (and skipped) regions:
//   - single-quoted strings, including '' escapes and backslash escapes
//   - double-quoted identifiers, including "" escapes
//   - -- line comments and /* … */ block comments
//   - $tag$ … $tag$ dollar-quoted strings (incl. $$ … $$)
function convertPlaceholders(sql) {
  let out = '';
  let index = 1; // next $n
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment (only when -- starts a comment: followed by space/control/end)
    if (ch === '-' && next === '-' && (i + 2 >= n || /[\s]/.test(sql[i + 2]))) {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // /* block comment */
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // 'single-quoted string' with '' and backslash escapes
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '\\' && j + 1 < n) { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // "double-quoted identifier" with "" escapes
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // $tag$ dollar-quoted string
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const stop = close === -1 ? n : close + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    // A real placeholder.
    if (ch === '?') {
      out += `$${index}`;
      index += 1;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return { text: out, count: index - 1 };
}

module.exports = { convertPlaceholders };
