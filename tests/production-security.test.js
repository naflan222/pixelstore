const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withServer, freshSqlitePath } = require('./helpers');

const root = path.resolve(__dirname, '..');
for (const key of ['DATABASE_URL', 'PG_MEM_TEST', 'BREVO_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FORCE_DEV_CODES']) {
  delete process.env[key];
}

test('production security preserves the storefront and shopping flow', async (t) => {
  await withServer(t, {
    NODE_ENV: 'production', DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(),
    SEED_DEMO_DATA: 'true',
  }, async ({ base, db, makeSession }) => {
    await t.test('production never creates the public demo owner', async () => {
      assert.equal((await db.get('SELECT COUNT(*) AS c FROM users')).c, 0);
      assert.equal((await makeSession().post('/api/auth/login', { username: 'demo', password: 'demo1234' })).status, 401);
    });

    await t.test('backend source and database files are not public', async () => {
      // Place a real file beneath the former static root, as with default SQLite.
      const fixture = path.join(root, 'data', `private-security-${process.pid}.db`);
      fs.mkdirSync(path.dirname(fixture), { recursive: true });
      fs.writeFileSync(fixture, 'private database contents');
      try {
        for (const url of [
          '/server/routes.js', '/server/db.js', '/package.json', '/package-lock.json',
          '/README.md', '/.env', '/.git/config', '/tests/helpers.js',
          `/data/${path.basename(fixture)}`,
          '/js/%2e%2e%2fserver/routes.js', '/img/%2e%2e%2fserver/routes.js',
          '/admin/%2e%2e%2fserver/routes.js', '/server%2froutes.js',
        ]) {
          const response = await fetch(base + url);
          assert.equal(response.status, 404, url);
        }
      } finally {
        fs.unlinkSync(fixture);
      }
    });

    await t.test('design assets and admin markup are served byte for byte', async () => {
      for (const file of [
        'style.css', 'js/api-client.js', 'css/bootstrap.min.css',
        'img/core-img/logo-mark-hd.png', 'admin/index.html',
        'service-worker.js', 'manifest.json', 'robots.txt',
      ]) {
        const response = await fetch(`${base}/${file}`);
        assert.equal(response.status, 200, file);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(root, file)), file);
      }
      for (const url of ['/', '/products.html', '/cart.html', '/checkout.html', '/login.html', '/admin/']) {
        assert.equal((await fetch(base + url)).status, 200, url);
      }
      assert.equal((await fetch(base + '/sitemap.xml')).status, 200);
    });

    const customer = makeSession();
    await t.test('registration, login, checkout and invoice still work', async () => {
      assert.equal((await customer.post('/api/auth/register', {
        username: 'securitycustomer', email: 'customer@example.test', password: 'unique-test-password',
      })).status, 200);
      assert.equal((await customer.post('/api/auth/login', {
        username: 'securitycustomer', password: 'unique-test-password',
      })).status, 200);
      const catalog = await customer.get('/api/products');
      assert.equal((await customer.post('/api/cart', { product_id: catalog.data.products[0].id, quantity: 1 })).status, 200);
      const order = await customer.post('/api/orders', {
        full_name: 'Test Customer', email: 'customer@example.test', phone: '123', address: 'Test Address',
        shipping_method: 'pickup', payment_method: 'cash',
      });
      assert.equal(order.status, 200);
      assert.equal((await customer.get('/api/orders')).data.orders.length, 1);
      const invoice = await customer.request('GET', order.data.invoice_url);
      assert.equal(invoice.status, 200);
      assert.match(invoice.headers.get('content-type'), /application\/pdf/);
    });

    await t.test('production reset fails safely without email, including dev-code override', async () => {
      for (const override of ['', '1']) {
        process.env.FORCE_DEV_CODES = override;
        const known = await customer.post('/api/auth/forgot-password', { email: 'customer@example.test' });
        const unknown = await customer.post('/api/auth/forgot-password', { email: 'unknown@example.test' });
        assert.equal(known.status, 503);
        assert.deepEqual(known.data, unknown.data);
        assert.equal(known.data.dev_code, undefined);
      }
      delete process.env.FORCE_DEV_CODES;
      assert.equal((await db.get('SELECT COUNT(*) AS c FROM password_resets')).c, 0);
    });

    await t.test('configured production email resets still work without exposing the code', async () => {
      process.env.BREVO_API_KEY = 'local-test-key';
      process.env.MAIL_FROM = 'support@example.test';
      const originalFetch = global.fetch;
      let delivery = null;
      global.fetch = async (url, options) => {
        if (String(url).startsWith('https://api.brevo.com/')) {
          delivery = JSON.parse(options.body);
          return new Response(JSON.stringify({ messageId: 'local-test' }), { status: 201 });
        }
        return originalFetch(url, options);
      };
      try {
        const result = await customer.post('/api/auth/forgot-password', { email: 'customer@example.test' });
        assert.equal(result.status, 200);
        assert.equal(result.data.dev_code, undefined);
        assert.equal(delivery.to[0].email, 'customer@example.test');
        const reset = await db.get('SELECT code FROM password_resets WHERE email = ?', 'customer@example.test');
        assert.ok(delivery.htmlContent.includes(reset.code));
        assert.ok(!JSON.stringify(result.data).includes(reset.code));
        assert.equal((await customer.post('/api/auth/reset-password', {
          email: 'customer@example.test', code: reset.code, password: 'changed-test-password',
        })).status, 200);
        assert.equal((await customer.post('/api/auth/login', {
          username: 'securitycustomer', password: 'changed-test-password',
        })).status, 200);
      } finally {
        global.fetch = originalFetch;
        delete process.env.BREVO_API_KEY;
        delete process.env.MAIL_FROM;
      }
    });

    await t.test('production restart does not promote or remove existing accounts', async () => {
      await db.run("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
        'legacydemo', 'demo@pixels.com', 'unused-test-hash', 'customer');
      const child = spawnSync(process.execPath, ['-e', `
        const db = require('./server/database');
        (async () => {
          await db.init();
          const user = await db.get("SELECT role FROM users WHERE email = ?", 'demo@pixels.com');
          require('node:assert/strict').equal(user.role, 'customer');
          await db.close();
        })().catch(e => { console.error(e); process.exitCode = 1; });
      `], { cwd: root, env: process.env, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
    });
  });
});

test('production PostgreSQL demo seeding never creates an owner', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const db = require('./server/database');
    (async () => {
      await db.init();
      require('node:assert/strict').equal(Number((await db.get('SELECT COUNT(*) AS c FROM users')).c), 0);
      await db.close();
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', DB_ENGINE: 'postgres', PG_MEM_TEST: '1', SEED_DEMO_DATA: 'true' },
  });
  assert.equal(child.status, 0, child.stderr);
});
