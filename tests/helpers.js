// Shared test harness: boots the real Express app on an ephemeral port with a
// caller-chosen database engine, and provides cookie-jar API sessions.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshSqlitePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelstore-test-'));
  return path.join(dir, 'test.db');
}

function makeSession(base) {
  const jar = {};
  function storeCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const header of setCookies) {
      const match = /^([^=]+)=([^;]*)/.exec(header);
      if (match) {
        if (match[2] === '' && /expires=thu, 01 jan 1970/i.test(header)) delete jar[match[1]];
        else jar[match[1]] = match[2];
      }
    }
  }
  function cookieHeader() {
    const pairs = Object.entries(jar).map(([key, value]) => `${key}=${value}`);
    return pairs.length ? { Cookie: pairs.join('; ') } : {};
  }
  return {
    jar,
    async request(method, urlPath, { body, contentType = 'application/json', rawBody } = {}) {
      const headers = { ...cookieHeader() };
      const options = { method, headers };
      if (rawBody !== undefined) {
        headers['Content-Type'] = contentType;
        options.body = rawBody;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      const res = await fetch(base + urlPath, options);
      storeCookies(res);
      return res;
    },
    async call(method, urlPath, body) {
      const res = await this.request(method, urlPath, { body });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, headers: res.headers };
    },
    get(urlPath) { return this.call('GET', urlPath); },
    post(urlPath, body) { return this.call('POST', urlPath, body); },
    put(urlPath, body) { return this.call('PUT', urlPath, body); },
    del(urlPath) { return this.call('DELETE', urlPath); },
  };
}

async function withServer(t, env, fn) {
  Object.assign(process.env, env);
  // eslint-disable-next-line global-require
  const { start } = require('../server/index.js');
  // eslint-disable-next-line global-require
  const db = require('../server/database.js');
  const { server, port } = await start(0);
  const base = `http://127.0.0.1:${port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });
  await fn({ base, db, makeSession: () => makeSession(base) });
}

module.exports = { freshSqlitePath, makeSession, withServer };
