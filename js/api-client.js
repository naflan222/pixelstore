/* Pixels store — frontend API client.
   Wires the existing static HTML pages to the Express/SQLite backend.
   Included at the bottom of every page; no changes to the template's design. */
(function () {
  'use strict';

  const page = (location.pathname.split('/').pop() || 'index.html');
  let currentUser = null;

  /* ---------- helpers ---------- */
  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  }
  const get = (p) => api(p);
  const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
  const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body || {}) });
  const del = (p) => api(p, { method: 'DELETE' });

  const money = (n) => 'Rs. ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function updateStockProgress(container, product) {
    const progressBar = $('.progress-bar', container);
    const progressTitle = $('.progress-title, .mb-1', container);
    if (!progressBar || !progressTitle || product.stock == null) return;
    const stock = Math.max(0, Number(product.stock));
    const stockPercent = Math.min(100, stock);
    progressTitle.textContent = stock + ' In Stock';
    progressBar.style.width = stockPercent + '%';
    progressBar.setAttribute('aria-valuenow', String(stockPercent));
    progressBar.setAttribute('aria-label', stock + ' items in stock');
    progressBar.classList.toggle('bg-danger', stock === 0);
    progressBar.classList.toggle('bg-warning', stock > 0);
  }

  async function updateFlashSaleStockBars() {
    const cards = $$('.flash-sale-card');
    if (!cards.length) return;
    try {
      const { products } = await get('/products');
      const productsBySlug = new Map(products.map((product) => [product.slug, product]));
      cards.forEach((card) => {
        const link = $('a[href$=".html"]', card);
        const slug = link && link.getAttribute('href').replace(/\.html$/, '');
        const product = productsBySlug.get(slug);
        if (product) updateStockProgress(card, product);
      });
    } catch (_) {}
  }

  function alertBox(form, message, type) {
    let box = $('.api-alert', form.parentElement || form);
    if (!box) {
      box = document.createElement('div');
      box.className = 'api-alert';
      form.parentElement.insertBefore(box, form);
    }
    box.className = 'api-alert alert alert-' + (type || 'danger') + ' py-2 px-3 mb-3';
    box.style.fontSize = '13px';
    box.textContent = message;
    box.style.display = 'block';
    if (type === 'success') setTimeout(() => { box.style.display = 'none'; }, 4000);
  }

  function productCardHTML(p) {
    const name = escapeHtml(p.name);
    const slug = escapeHtml(p.slug);
    const image = escapeHtml(p.image);
    const productUrl = 'single-product.html?product=' + encodeURIComponent(p.slug);
    const badge = p.badge ? '<span class="badge rounded-pill badge-warning">' + escapeHtml(p.badge) + '</span>' : '';
    const old = p.old_price ? '<span>' + money(p.old_price) + '</span>' : '';
    const outOfStock = p.stock != null && p.stock <= 0;
    const stockBadge = outOfStock ? '<span class="badge rounded-pill badge-danger" style="position:absolute;top:8px;left:8px;">Out of Stock</span>' : '';
    const rating = Number(p.rating_count) > 0
      ? '<div class="product-rating"><i class="ti ti-star-filled"></i>' + Number(p.rating).toFixed(1) +
        ' <span class="ms-1">(' + Number(p.rating_count) + ')</span></div>'
      : '<div class="product-rating text-muted">No reviews yet</div>';
    const addBtn = outOfStock
      ? '<a class="btn btn-secondary btn-sm disabled" href="#" style="opacity:.5;pointer-events:none;cursor:not-allowed"><i class="ti ti-x"></i></a>'
      : '<a class="btn btn-success btn-sm" href="#" data-cart-id="' + p.id + '"><i class="ti ti-plus"></i></a>';
    return (
      '<div class="col-6 col-md-4">' +
        '<div class="card product-card catalog-product-card" style="position:relative">' +
          '<div class="card-body">' +
            badge + stockBadge +
            '<a class="product-thumbnail d-block" href="' + productUrl + '"><img class="mb-2" src="' + image + '" alt="' + name + '" loading="lazy" decoding="async"></a>' +
            '<a class="product-title" href="' + productUrl + '">' + name + '</a>' +
            '<p class="sale-price">' + money(p.price) + old + '</p>' +
            rating +
            addBtn +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function bindProductButtons(root) {
    // Buttons with data-cart-id (numeric product ID — used on dynamically rendered grids)
    $$('[data-cart-id]', root).forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await post('/cart', { product_id: Number(el.dataset.cartId) });
          el.innerHTML = '<i class="ti ti-check"></i>';
          setTimeout(() => { el.innerHTML = '<i class="ti ti-plus"></i>'; }, 1500);
          refreshCartBadge();
        } catch (err) { alert(err.message); }
      });
    });
    // Buttons with data-cart-slug (used on static product cards like home.html)
    $$('[data-cart-slug]', root).forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await post('/cart/by-slug', { slug: el.dataset.cartSlug });
          el.innerHTML = '<i class="ti ti-check"></i>';
          setTimeout(() => { el.innerHTML = '<i class="ti ti-plus"></i>'; }, 1500);
          refreshCartBadge();
        } catch (err) { alert(err.message); }
      });
    });
    // Generic "+" add-to-cart buttons without any data attribute —
    // extract the slug from the nearest .product-title link inside the same card.
    // Only match buttons that contain a ti-plus icon to avoid catching other btn-primary buttons.
    $$('.product-card .btn-primary:not([data-cart-id]):not([data-cart-slug])', root).forEach((el) => {
      if (el.dataset.cartBound) return;
      if (!el.querySelector('.ti-plus')) return; // only "+" buttons
      el.dataset.cartBound = '1';
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        const card = el.closest('.product-card') || el.closest('.card');
        const titleLink = card && $('.product-title', card);
        if (!titleLink) return;
        const href = titleLink.getAttribute('href') || '';
        const slug = href.replace(/\.html$/, '');
        if (!slug || slug === '#' || slug === 'single-product') return; // skip demo products
        try {
          await post('/cart/by-slug', { slug });
          el.innerHTML = '<i class="ti ti-check"></i>';
          setTimeout(() => { el.innerHTML = '<i class="ti ti-plus"></i>'; }, 1500);
          refreshCartBadge();
        } catch (err) { alert(err.message); }
      });
    });
  }

  async function wireCategoryCatalog() {
    const section = $('[data-catalog-category]');
    if (!section) return;
    const grid = $('.row.g-2', section);
    if (!grid) return;
    const category = section.dataset.catalogCategory || '';
    const perPage = 12;
    const queryPage = Number(new URLSearchParams(location.search).get('page'));
    let currentPage = Number.isInteger(queryPage) && queryPage > 0
      ? queryPage
      : (page === 'gpproducts2.html' ? 2 : 1);
    const fallbackHTML = grid.innerHTML;
    let paginationNav = $('nav[aria-label="Page navigation"]', section);
    if (!paginationNav) {
      paginationNav = document.createElement('nav');
      paginationNav.setAttribute('aria-label', 'Page navigation');
      paginationNav.innerHTML = '<ul class="pagination justify-content-center flex-wrap"></ul>';
    }
    if (paginationNav.parentElement === grid) grid.after(paginationNav);
    if (!paginationNav.isConnected) grid.after(paginationNav);
    let pagination = $('.pagination', paginationNav);
    if (!pagination) {
      pagination = document.createElement('ul');
      pagination.className = 'pagination justify-content-center flex-wrap';
      paginationNav.appendChild(pagination);
    }

    // Remove template products immediately so stale sample cards do not look
    // like the live catalog while its first page is loading.
    grid.innerHTML = '<div class="col-12"><div class="catalog-loading" role="status">Loading products…</div></div>';
    try {
      const params = new URLSearchParams({
        category,
        page: String(currentPage),
        limit: String(perPage),
      });
      const { products, pagination: pageInfo } = await get('/products?' + params.toString());
      if (!Array.isArray(products)) {
        grid.innerHTML = fallbackHTML;
        return;
      }
      currentPage = Number(pageInfo && pageInfo.page) || currentPage;

      function pageHref(targetPage) {
        if (category.toLowerCase() === 'gopro accessories') {
          if (targetPage === 1) return 'catagory.html';
          if (targetPage === 2) return 'gpproducts2.html';
          return 'catagory.html?page=' + targetPage;
        }
        const params = new URLSearchParams(location.search);
        if (targetPage === 1) params.delete('page');
        else params.set('page', String(targetPage));
        return page + (params.size ? '?' + params.toString() : '');
      }

      const pageCount = Math.max(1, Number(pageInfo && pageInfo.pages) || Math.ceil(products.length / perPage));
      const visibleProducts = pageInfo ? products : products.slice((currentPage - 1) * perPage, currentPage * perPage);
      grid.innerHTML = visibleProducts.length
        ? visibleProducts.map(productCardHTML).join('')
        : '<div class="col-12"><div class="catalog-empty-state">No products in this category yet. Please check back soon.</div></div>';
      paginationNav.hidden = pageCount < 2;
      paginationNav.style.display = pageCount < 2 ? 'none' : '';
      pagination.innerHTML = pageCount < 2 ? '' : Array.from({ length: pageCount }, (_, index) => {
        const targetPage = index + 1;
        const active = targetPage === currentPage;
        return '<li class="page-item' + (active ? ' active' : '') + '"><a class="page-link" href="' +
          pageHref(targetPage) + '"' + (active ? ' aria-current="page"' : '') + '>' + targetPage + '</a></li>';
      }).join('');
      bindProductButtons(grid);
    } catch (_) {
      // Fall back to the page's existing cards if the catalog API is unavailable.
      grid.innerHTML = fallbackHTML;
    }
  }

  async function hideRemovedCatalogCards() {
    if (page !== 'home.html' && !$('.related-product-wrapper')) return;
    try {
      const { products } = await get('/products');
      const activeSlugs = new Set((products || []).map((product) => String(product.slug)));
      const cards = page === 'home.html'
        ? $$('.product-card, .horizontal-product-card, .featured-product-card')
        : $$('.related-product-wrapper .product-card');
      cards.forEach((card) => {
        const link = $('.product-title[href], .product-thumbnail[href]', card);
        if (!link) return;
        const href = link.getAttribute('href') || '';
        let slug = '';
        try {
          const target = new URL(href, location.href);
          slug = target.searchParams.get('product') || target.pathname.split('/').pop().replace(/\.html$/i, '');
        } catch (_) { return; }
        if (!slug || slug === 'single-product' || slug === 'products' || activeSlugs.has(slug)) return;
        const column = card.parentElement && /\bcol(?:-|\s)/.test(card.parentElement.className) ? card.parentElement : null;
        (column || card).remove();
      });
    } catch (_) {
      // Keep static markup if the public catalog cannot be reached.
    }
  }

  function requireLogin() {
    if (!currentUser) {
      location.href = 'login.html';
      return false;
    }
    return true;
  }

  // Payment pages (cash / credit-card / bank / paypal): clicking the order button
  // places the REAL order with the chosen payment + shipping method.
  function placeOrderPage(paymentMethod) {
    return function () {
      const btn = $('a[href="payment-success.html"]');
      if (!btn) return;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        // Billing details were validated & saved on the checkout page
        let billing = null;
        try { billing = JSON.parse(sessionStorage.getItem('guest_billing') || 'null'); } catch (_) {}
        if (!billing && currentUser) {
          billing = {
            full_name: currentUser.full_name || currentUser.username,
            email: currentUser.email,
            phone: currentUser.phone || '',
            address: currentUser.address || '',
          };
        }
        if (!billing || !billing.phone || !billing.address || !billing.full_name) {
          alert('Please fill in your billing information first.');
          location.href = 'checkout.html';
          return;
        }
        btn.classList.add('disabled');
        btn.textContent = 'Placing order...';
        try {
          const r = await post('/orders', {
            ...billing,
            shipping_method: sessionStorage.getItem('shipping_method') || 'standard',
            payment_method: paymentMethod,
          });
          sessionStorage.setItem('last_order', JSON.stringify({
            order_id: r.order_id,
            total: r.total,
            payment_method: paymentMethod,
            invoice_number: r.invoice_number || '',
            invoice_file: r.invoice_file || '',
            invoice_url: r.invoice_url || ('/api/orders/' + r.order_id + '/invoice'),
          }));
          sessionStorage.removeItem('guest_billing');
          location.href = r.redirect || 'payment-success.html';
        } catch (err) {
          btn.classList.remove('disabled');
          btn.textContent = 'Try Again';
          alert(err.message);
        }
      });
    };
  }

  /* ---------- session ---------- */
  function setSessionNavigation(isAuthenticated) {
    $$('a[href="intro.html"], a[href="login.html"]').forEach((link) => {
      link.href = isAuthenticated ? 'intro.html' : 'login.html';
      link.innerHTML = isAuthenticated
        ? '<i class="ti ti-logout"></i>Sign Out'
        : '<i class="ti ti-login"></i>Sign In';
    });
  }

  async function loadSession() {
    try {
      const data = await get('/auth/me');
      currentUser = data.user;
      setSessionNavigation(true);
      // Sidenav identity
      const name = $('.sidenav-profile .user-name');
      if (name) name.textContent = currentUser.username;
      const accountName = document.getElementById('accountDisplayName');
      if (accountName) accountName.textContent = currentUser.username;
      // Notification badge
      const badge = $('.sidenav-nav .badge');
      if (badge) {
        badge.textContent = data.unread_notifications;
        badge.style.display = data.unread_notifications ? '' : 'none';
      }
      // Cart count badges used by the template
      updateCartBadge(data.cart_count);
      // Wire sign-out link
      $$('a[href="intro.html"]').forEach((a) => {
        if (/sign\s*out/i.test(a.textContent)) {
          a.addEventListener('click', async (e) => {
            e.preventDefault();
            await post('/auth/logout');
            location.href = 'home.html';
          });
        }
      });
    } catch (_) {
      currentUser = null;
      setSessionNavigation(false);
      const name = $('.sidenav-profile .user-name');
      if (name) name.textContent = 'Guest';
      const accountName = document.getElementById('accountDisplayName');
      if (accountName) accountName.textContent = 'Guest';
      // Guests still get a cart badge
      refreshCartBadge();
    }
  }

  function updateCartBadge(count) {
    $$('.cart-count, [data-cart-count]').forEach((el) => { el.textContent = count; });
  }

  async function refreshCartBadge() {
    try {
      const data = await get('/cart');
      updateCartBadge(data.items.reduce((s, i) => s + i.quantity, 0));
    } catch (_) {}
  }

  /* ---------- page wiring ---------- */
  const wiring = {
    'login.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await post('/auth/login', {
            username: $('#username').value.trim(),
            password: $('#password').value,
          });
          location.href = r.redirect || 'home.html';
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'register.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
        try {
          await post('/auth/register', {
            username: $('#username').value.trim(),
            email: $('#email').value.trim(),
            password: $('#registerPassword').value,
          });
          // Show professional success message, then redirect to login
          const wrap = $('.register-form') || form.parentElement;
          wrap.innerHTML =
            '<div class="text-center py-4">' +
              '<div style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center">' +
                '<i class="ti ti-check" style="font-size:32px;color:#fff"></i>' +
              '</div>' +
              '<h5 style="color:#1f0755;font-weight:700;margin-bottom:8px">Successfully Signed Up!</h5>' +
              '<p style="color:#6b7280;font-size:14px;margin-bottom:16px">Your account has been created. Please log in to continue shopping.</p>' +
              '<a class="btn btn-warning btn-lg w-100" href="login.html">Go to Login</a>' +
            '</div>';
        } catch (err) {
          alertBox(form, err.message);
          if (btn) { btn.disabled = false; btn.textContent = 'Sign Up'; }
        }
      });
    },

    'forget-password.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      const input = $('input', form);
      const btn = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (input && input.value || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          alertBox(form, 'Please enter a valid email address.');
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Sending code...'; }
        try {
          const r = await post('/auth/forgot-password', { email });
          sessionStorage.setItem('reset_email', email);
          sessionStorage.removeItem('reset_code');
          alertBox(form, r.message + (r.dev_code ? ' Code: ' + r.dev_code : ''), 'success');
          setTimeout(() => { location.href = 'otp-confirm.html'; }, 2500);
        } catch (err) {
          alertBox(form, err.message);
          if (btn) { btn.disabled = false; btn.textContent = 'Reset Password'; }
        }
      });
    },

    'otp-confirm.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      const codeInputs = $$('.single-otp-input', form);
      const btn = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = codeInputs.map((i) => i.value).join('').trim();
        if (code.length !== 6) {
          alertBox(form, 'Please enter the full 6-digit code from your email.');
          return;
        }
        const email = sessionStorage.getItem('reset_email');
        if (!email) {
          alertBox(form, 'No email on file. Please request a new code first.');
          setTimeout(() => { location.href = 'forget-password.html'; }, 1500);
          return;
        }
        if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }
        try {
          // Check the code right away so a wrong code is caught here,
          // before the user types a new password.
          await post('/auth/verify-code', { email, code });
          sessionStorage.setItem('reset_code', code);
          location.href = 'change-password.html';
        } catch (err) {
          alertBox(form, err.message);
          if (btn) { btn.disabled = false; btn.textContent = 'Verify & Proceed'; }
          codeInputs.forEach((i) => { i.value = ''; });
          if (codeInputs[0]) codeInputs[0].focus();
        }
      });

      // "Resend OTP" link (appears after the 60s countdown in otp-timer.js)
      const host = $('#resendOTP');
      if (host) {
        host.addEventListener('click', async (e) => {
          const link = e.target.closest('.resendOTP');
          if (!link) return;
          e.preventDefault();
          const email = sessionStorage.getItem('reset_email');
          if (!email) { alertBox(form, 'No email on file. Please start over.'); return; }
          try {
            const r = await post('/auth/forgot-password', { email });
            alertBox(form, r.message, 'success');
            if (window.__restartOtpTimer) window.__restartOtpTimer();
          } catch (err) { alertBox(form, err.message); }
        });
      }
    },

    'change-password.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      const fields = $$('input[type="password"]', form);
      const email = sessionStorage.getItem('reset_email');
      const code = sessionStorage.getItem('reset_code');
      const isReset = !!(email && code);
      if (isReset) {
        // Reset mode: the email OTP replaces the "Old Password" field.
        const oldField = fields[0] && fields[0].closest('.mb-3');
        if (oldField) oldField.style.display = 'none';
        const title = $('.page-heading h6');
        if (title) title.textContent = 'Reset Password';
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isReset) {
          const newPwd = fields[1].value;
          const confirmPwd = fields[2] ? fields[2].value : newPwd;
          if (newPwd.length < 8) { alertBox(form, 'New password must be at least 8 characters.'); return; }
          if (newPwd !== confirmPwd) { alertBox(form, 'New passwords do not match.'); return; }
          try {
            const r = await post('/auth/reset-password', { email, code, password: newPwd });
            sessionStorage.removeItem('reset_email');
            sessionStorage.removeItem('reset_code');
            location.href = r.redirect || 'forget-password-success.html';
          } catch (err) {
            alertBox(form, err.message);
            if (/invalid or expired|too many attempts/i.test(err.message)) {
              sessionStorage.removeItem('reset_email');
              sessionStorage.removeItem('reset_code');
            }
          }
        } else {
          if (!requireLogin()) return;
          const current = fields[0].value;
          const newPwd = fields[1] ? fields[1].value : current;
          const confirmPwd = fields[2] ? fields[2].value : newPwd;
          if (newPwd.length < 8) { alertBox(form, 'New password must be at least 8 characters.'); return; }
          if (newPwd !== confirmPwd) { alertBox(form, 'New passwords do not match.'); return; }
          try {
            await post('/auth/change-password', {
              current_password: current,
              new_password: newPwd,
            });
            alertBox(form, 'Password changed successfully.', 'success');
          } catch (err) { alertBox(form, err.message); }
        }
      });
    },

    'edit-profile.html': function () {
      const form = $('.user-data-card form');
      if (!form) return;
      const inputs = $$('input', form);
      const [username, fullName, phone, email, address] = inputs;
      if (currentUser) {
        username.value = currentUser.username || '';
        fullName.value = currentUser.full_name || '';
        phone.value = currentUser.phone || '';
        email.value = currentUser.email || '';
        address.value = currentUser.address || '';
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!requireLogin()) return;
        try {
          await put('/profile', {
            username: username.value.trim(),
            phone: phone.value.trim(),
            email: email.value.trim(),
            address: address.value.trim(),
          });
          alertBox(form, 'Profile saved.', 'success');
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'cart.html': async function () {
      const tbody = $('.cart-table tbody') || document.getElementById('cartTbody');
      if (!tbody) return;
      const totalWrap = $('.cart-amount-area'); // contains the "Rs. 38.84" demo number
      // Hide the demo total IMMEDIATELY so it never flashes before real data loads
      if (totalWrap) totalWrap.style.display = 'none';
      let data;
      try { data = await get('/cart'); } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-danger">Could not load cart. Please refresh the page.</td></tr>';
        return;
      }

      function render(items) {
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">Your cart is empty. <a href="home.html">Shop now</a></td></tr>';
          // Hide the total bar so the stale demo number never shows on an empty cart
          if (totalWrap) totalWrap.style.display = 'none';
        } else {
          if (totalWrap) totalWrap.style.display = '';
          tbody.innerHTML = items.map((i) => (
            '<tr>' +
              '<th scope="row"><a class="remove-product" href="#" data-remove="' + i.cart_id + '"><i class="ti ti-x"></i></a></th>' +
              '<td><img class="rounded" src="' + escapeHtml(i.image) + '" alt="' + escapeHtml(i.name) + '"></td>' +
              '<td><a class="product-title" href="' + escapeHtml(i.slug) + '.html">' + escapeHtml(i.name) +
                '<span class="mt-1">' + money(i.price) + ' × ' + i.quantity + '</span></a></td>' +
              '<td><div class="quantity"><input class="qty-text" type="number" min="1" max="99" value="' + i.quantity +
                '" data-qty="' + i.cart_id + '"></div></td>' +
            '</tr>'
          )).join('');
        }
        const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
        const totalEl = $('.cart-amount-area .cart-total');
        if (totalEl) totalEl.textContent = subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        $$('[data-remove]', tbody).forEach((el) => el.addEventListener('click', async (e) => {
          e.preventDefault();
          await del('/cart/' + el.dataset.remove);
          refresh();
        }));
        $$('[data-qty]', tbody).forEach((el) => el.addEventListener('change', async () => {
          await put('/cart/' + el.dataset.qty, { quantity: Number(el.value) });
          refresh();
        }));
      }
      async function refresh() {
        data = await get('/cart');
        render(data.items);
        refreshCartBadge();
      }
      render(data.items);
    },

    'checkout.html': async function () {
      // Works for guests too — billing info is entered right on this page
      const checkoutTotal = $('.cart-amount-area');
      // Hide the demo "Rs. 39.84" IMMEDIATELY so it never flashes before real data loads
      if (checkoutTotal) checkoutTotal.style.display = 'none';
      const billingCard = $('.billing-information-card .user-data-card .card-body');
      const billing = currentUser ? {
        name: currentUser.full_name || currentUser.username || '',
        email: currentUser.email || '',
        phone: currentUser.phone || '',
        address: currentUser.address || '',
      } : { name: '', email: '', phone: '', address: '' };
      try {
        const saved = JSON.parse(sessionStorage.getItem('guest_billing') || 'null');
        if (!currentUser && saved) Object.assign(billing, saved);
      } catch (_) {}

      // Replace the static billing card with an editable form
      if (billingCard) {
        billingCard.innerHTML =
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-user"></i><span>Full Name</span></div>' +
            '<input class="form-control" id="billName" type="text" placeholder="Your full name" value="' + escapeHtml(billing.name) + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-mail"></i><span>Email Address</span></div>' +
            '<input class="form-control" id="billEmail" type="email" placeholder="you@example.com" value="' + escapeHtml(billing.email) + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-phone"></i><span>Phone Number</span></div>' +
            '<input class="form-control" id="billPhone" type="text" placeholder="07X XXX XXXX" value="' + escapeHtml(billing.phone) + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-location"></i><span>Shipping Address</span></div>' +
            '<input class="form-control" id="billAddress" type="text" placeholder="Street, City" value="' + escapeHtml(billing.address) + '"></div>' +
          '<div class="api-alert alert alert-danger py-2 px-3 mb-2" id="billError" style="display:none;font-size:13px"></div>';
      }

      function billingValid() {
        const err = $('#billError');
        const name = $('#billName') && $('#billName').value.trim();
        const email = $('#billEmail') && $('#billEmail').value.trim();
        const phone = $('#billPhone') && $('#billPhone').value.trim();
        const address = $('#billAddress') && $('#billAddress').value.trim();
        let msg = '';
        if (!name) msg = 'Please enter your full name.';
        else if (!phone) msg = 'Please enter your phone number.';
        else if (!address) msg = 'Please enter your shipping address.';
        else if (!email) msg = 'Please enter your email address.';
        if (msg && err) { err.textContent = msg; err.style.display = 'block'; return null; }
        if (err) err.style.display = 'none';
        return { full_name: name, email, phone, address };
      }

      // Shipping methods: radio id → { api method, fee }
      const SHIPPING = {
        standardShipping: { method: 'standard', fee: 500 },
        storePickup: { method: 'pickup', fee: 0 },
      };

      let subtotal = 0;
      try {
        const data = await get('/cart');
        subtotal = data.subtotal;
        if (!data.items.length) {
          const btn = $('.cart-amount-area .btn');
          if (btn) { btn.textContent = 'Cart is Empty'; btn.classList.add('disabled'); }
        }
      } catch (_) {}

      // Live total: subtotal + selected shipping fee, updates when user picks shipping
      function selectedShipping() {
        const checked = $('input[name="selector"]:checked');
        return SHIPPING[checked ? checked.id : 'standardShipping'] || SHIPPING.standardShipping;
      }
      function updateTotal() {
        const totalEl = $('.cart-amount-area .cart-total');
        if (totalEl) totalEl.textContent = (subtotal + selectedShipping().fee).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        // Only reveal the total bar once it holds the REAL cart total
        if (checkoutTotal && subtotal > 0) checkoutTotal.style.display = '';
      }
      $$('input[name="selector"]').forEach((r) => r.addEventListener('change', updateTotal));
      updateTotal();

      // "Confirm & Pay" → validate billing first, then go to payment-method page
      $$('a[href="checkout-payment.html"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (!subtotal) { alert('Your cart is empty.'); return; }
          const b = billingValid();
          if (!b) return; // missing name / phone / address → block
          sessionStorage.setItem('guest_billing', JSON.stringify(b));
          sessionStorage.setItem('shipping_method', selectedShipping().method);
          location.href = 'checkout-payment.html';
        });
      });
    },

    // --- Final payment pages: place the real order on button click ---
    'checkout-cash.html': placeOrderPage('cash'),
    'checkout-bank.html': placeOrderPage('bank'),

    // --- Success page: the order's branded PDF invoice downloads itself ---
    'payment-success.html': function () {
      const info = sessionStorage.getItem('last_order');
      if (!info) return;
      try {
        const order = JSON.parse(info) || {};
        const orderId = Number(order.order_id);
        if (!Number.isSafeInteger(orderId) || orderId < 1) return;

        const invoiceUrl = order.invoice_url || ('/api/orders/' + orderId + '/invoice');
        const download = $('#invoiceDownload');
        if (!download) return;
        download.href = invoiceUrl;
        // Keeps the saved file name identical to the one the server suggests.
        download.setAttribute('download', order.invoice_file || ('PixelHouse-Invoice-' + orderId + '.pdf'));

        const preview = $('#invoicePreview');
        if (preview) preview.href = invoiceUrl + '?view=1';

        const text = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
        const receipt = $('#invoiceReceipt');
        if (receipt) receipt.classList.remove('d-none');
        text('#invoiceNumber', order.invoice_number || ('Order #' + orderId));
        text('#invoiceOrderNo', '#' + orderId);
        text('#invoiceTotal', money(order.total));
        text('#invoicePaymentMethod', order.payment_method ? '· paid with ' + String(order.payment_method).replace('-', ' ') : '');

        const downloadedKey = 'invoice_downloaded_' + orderId;
        if (sessionStorage.getItem(downloadedKey)) {
          text('#invoiceNote', 'Invoice already downloaded for this order — use the button above to save another copy.');
        } else {
          setTimeout(() => {
            sessionStorage.setItem(downloadedKey, '1');
            download.click();
          }, 400);
        }
      } catch (_) {}
    },

    'my-order.html': async function () {
      const wrap = $('.my-order-area, .order-wrapper, .page-content-wrapper .container');
      if (!wrap) return;
      if (!currentUser) return;
      try {
        const { orders } = await get('/orders');
        if (!orders.length) return; // keep template demo content
        wrap.innerHTML = orders.map((o) => (
          '<div class="card mb-3"><div class="card-body">' +
            '<div class="d-flex justify-content-between"><h6>Order #' + o.id + '</h6>' +
            '<span class="badge badge-' + (o.status === 'pending' ? 'warning' : 'success') + '">' + escapeHtml(o.status) + '</span></div>' +
            '<p class="mb-1 text-muted" style="font-size:12px">' + escapeHtml(o.created_at) + ' · ' + escapeHtml(o.payment_method) + '</p>' +
            o.items.map((i) => '<div class="d-flex justify-content-between" style="font-size:13px"><span>' + escapeHtml(i.name) + ' × ' + Number(i.quantity) + '</span><span>' + money(i.price * i.quantity) + '</span></div>').join('') +
            '<hr><div class="d-flex justify-content-between"><strong>Total</strong><strong>' + money(o.total) + '</strong></div>' +
            '<div class="text-right mt-2"><a class="btn btn-sm btn-outline-primary" href="/api/orders/' + o.id + '/invoice" download title="Download the PDF invoice for order #' + o.id + '"><i class="ti ti-file-download"></i> Invoice (PDF)</a></div>' +
          '</div></div>'
        )).join('');
      } catch (_) {}
    },

    'notifications.html': async function () {
      const wrap = $('.notification-area, .page-content-wrapper .container');
      if (!wrap || !currentUser) return;
      try {
        const { notifications } = await get('/notifications');
        if (!notifications.length) return;
        wrap.innerHTML = notifications.map((n) => (
          '<div class="card mb-2"><div class="card-body py-2">' +
            '<h6 class="mb-1">' + escapeHtml(n.title) + '</h6>' +
            '<p class="mb-1" style="font-size:13px">' + escapeHtml(n.body) + '</p>' +
            '<small class="text-muted">' + escapeHtml(n.created_at) + '</small>' +
          '</div></div>'
        )).join('');
        await post('/notifications/read');
      } catch (_) {}
    },

    'become-vendor.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!requireLogin()) return;
        if (!$('#acceptTerms').checked) { alertBox(form, 'Please accept the terms & conditions.'); return; }
        const type = $('#personal').checked ? 'personal' : 'business';
        try {
          await post('/vendor/apply', {
            account_type: type,
            store_name: $('#username').value.trim(),
            location: $('#location').value.trim(),
            mobile: $('#mobileNumber').value.trim(),
          });
          alertBox(form, 'Application submitted! We will review it shortly.', 'success');
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'contact.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      // Prefill from ?subject= & ?message= (used by Camera Trade enquiries)
      const params = new URLSearchParams(location.search);
      const prefillInputs = $$('input', form);
      const prefillMessage = $('textarea', form);
      if (params.get('subject') && prefillInputs[2]) prefillInputs[2].value = params.get('subject');
      if (params.get('message') && prefillMessage) prefillMessage.value = params.get('message');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputs = $$('input', form);
        const textarea = $('textarea', form);
        try {
          await post('/contact', {
            name: inputs[0] ? inputs[0].value : '',
            email: inputs[1] ? inputs[1].value : (currentUser ? currentUser.email : ''),
            subject: inputs[2] ? inputs[2].value : '',
            message: textarea ? textarea.value : '',
          });
          alertBox(form, 'Message sent! We will get back to you soon.', 'success');
          form.reset();
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'profile.html': function () {
      const username = currentUser ? currentUser.username : 'Guest';
      const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
      set('profileUsername', username);
      set('profileDisplayName', username);
      if (!currentUser) return;
      set('profileFullName', (currentUser.full_name || '').toUpperCase() || username.toUpperCase());
      set('profilePhone', currentUser.phone || '—');
      // Fill email row by position among the profile data rows
      const rows = $$('.profile-wrapper-area .single-profile-data .data-content, .user-data-card .single-profile-data .data-content');
      rows.forEach((el) => {
        if (el.previousElementSibling && /Email/i.test(el.previousElementSibling.textContent)) {
          el.textContent = currentUser.email || '—';
        }
        if (el.previousElementSibling && /Shipping/i.test(el.previousElementSibling.textContent)) {
          el.textContent = currentUser.address || '—';
        }
      });
      const headerName = $('.user-info-card .user-info h5');
      if (headerName) headerName.textContent = username;
      // Sidenav profile name
      const sideName = $('.sidenav-profile .user-name');
      if (sideName) sideName.textContent = username;
    },

    'featured-products.html': async function () { await renderProductGrid({ featured: '1' }); },
    'flash-sale.html': async function () { await renderProductGrid({ flash_sale: '1' }); },

    'shop-list.html': async function () { await renderProductGrid({}); },
    'products.html': async function () { await wireAllProductsPage(); },
  };

  async function renderProductGrid(query) {
    const grid = $('.flash-sale-wrapper .row, .featured-products-wrapper .row, .top-products-area .row, .page-content-wrapper .row.g-2, .page-content-wrapper > .container > .row.g-2');
    const grid2 = grid || $('.page-content-wrapper .py-3 .container .row.g-2');
    if (!grid2) return;
    try {
      const qs = new URLSearchParams(query).toString();
      const { products } = await get('/products?' + qs);
      if (!products.length) return;
      grid2.innerHTML = products.map(productCardHTML).join('');
      bindProductButtons(grid2);
    } catch (_) {}
  }

  async function wireAllProductsPage() {
    const grid = $('#allProductsGrid');
    const categoryWrap = $('#allProductsCategories');
    const searchForm = $('#allProductsSearch');
    const searchInput = $('#allProductsSearchInput');
    const pagination = $('#allProductsPagination');
    const count = $('#allProductsCount');
    const empty = $('#allProductsEmpty');
    if (!grid || !categoryWrap || !searchForm || !searchInput || !pagination || !count || !empty) return;

    const perPage = 12;
    let products = [];
    let category = new URLSearchParams(location.search).get('category') || '';
    let search = new URLSearchParams(location.search).get('q') || '';
    let currentPage = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
    searchInput.value = search;

    function updateUrl() {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search) params.set('q', search);
      if (currentPage > 1) params.set('page', currentPage);
      history.replaceState(null, '', 'products.html' + (params.size ? '?' + params.toString() : ''));
    }

    function filteredProducts() {
      const words = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
      return products.filter((product) =>
        (!category || product.category === category) &&
        words.every((word) => (product.name + ' ' + (product.description || '')).toLowerCase().includes(word))
      );
    }

    function renderCategories() {
      const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort();
      categoryWrap.innerHTML = [
        '<button class="btn btn-sm ' + (!category ? 'btn-primary' : 'btn-outline-primary') + '" type="button" data-category="">All</button>',
        ...categories.map((name) => '<button class="btn btn-sm ' + (category === name ? 'btn-primary' : 'btn-outline-primary') + '" type="button" data-category="' + escapeHtml(name) + '">' + escapeHtml(name) + '</button>'),
      ].join('');
    }

    function renderPagination(pageCount) {
      if (pageCount < 2) { pagination.innerHTML = ''; return; }
      const buttons = [];
      buttons.push('<li class="page-item ' + (currentPage === 1 ? 'disabled' : '') + '"><button class="page-link" type="button" data-page="' + (currentPage - 1) + '" aria-label="Previous page"><i class="ti ti-chevron-left"></i></button></li>');
      for (let number = 1; number <= pageCount; number += 1) {
        buttons.push('<li class="page-item ' + (number === currentPage ? 'active' : '') + '"><button class="page-link" type="button" data-page="' + number + '" aria-label="Page ' + number + '" aria-current="' + (number === currentPage ? 'page' : 'false') + '">' + number + '</button></li>');
      }
      buttons.push('<li class="page-item ' + (currentPage === pageCount ? 'disabled' : '') + '"><button class="page-link" type="button" data-page="' + (currentPage + 1) + '" aria-label="Next page"><i class="ti ti-chevron-right"></i></button></li>');
      pagination.innerHTML = buttons.join('');
    }

    function render() {
      const matches = filteredProducts();
      const pageCount = Math.max(1, Math.ceil(matches.length / perPage));
      currentPage = Math.min(currentPage, pageCount);
      const start = (currentPage - 1) * perPage;
      const visibleProducts = matches.slice(start, start + perPage);
      count.textContent = matches.length + ' product' + (matches.length === 1 ? '' : 's');
      grid.innerHTML = visibleProducts.map(productCardHTML).join('');
      empty.classList.toggle('d-none', matches.length > 0);
      renderCategories();
      renderPagination(pageCount);
      bindProductButtons(grid);
      updateUrl();
    }

    categoryWrap.addEventListener('click', (event) => {
      const button = event.target.closest('[data-category]');
      if (!button) return;
      category = button.dataset.category;
      currentPage = 1;
      render();
    });
    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      search = searchInput.value.trim();
      currentPage = 1;
      render();
    });
    pagination.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.closest('.disabled')) return;
      currentPage = Number(button.dataset.page);
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    try {
      const data = await get('/products');
      products = data.products || [];
      render();
    } catch (_) {
      empty.textContent = 'Products are unavailable right now. Please try again.';
      empty.classList.remove('d-none');
    }
  }

  /* ---------- product detail pages: wire "Add to Cart" ---------- */
  async function wireProductDetail() {
    const queryProduct = new URLSearchParams(location.search).get('product');
    const slug = queryProduct || page.replace('.html', '');
    const isDynamicProduct = page === 'single-product.html' && Boolean(queryProduct);
    // Only run on actual product detail pages (not home, index, cart, etc.)
    if (!slug || page === 'index.html' || page === 'home.html') return;

    let liveProduct = null;
    try {
      const result = await get('/products/' + encodeURIComponent(slug));
      liveProduct = result.product;
      if (isDynamicProduct && liveProduct) {
        const title = $('.p-title-price h5');
        const price = $('.p-title-price .sale-price');
        const description = $('.p-specification .container p');
        const slides = $('.product-slides');
        if (title) title.textContent = liveProduct.name;
        if (price) price.innerHTML = money(liveProduct.price) + (liveProduct.old_price ? '<span>' + money(liveProduct.old_price) + '</span>' : '');
        if (description) description.textContent = liveProduct.description || 'Contact PixelHouse for more product details.';
        if (slides) {
          const carousel = window.jQuery ? window.jQuery(slides) : null;
          if (carousel && carousel.data('owl.carousel')) carousel.owlCarousel('destroy');
          const gallery = Array.from(new Set([
            liveProduct.image,
            ...(Array.isArray(liveProduct.images) ? liveProduct.images : []),
          ].filter((image) => typeof image === 'string' && image.trim())));
          slides.innerHTML = gallery.map((image) =>
            '<div class="single-product-slide dynamic-product-slide"><img class="dynamic-product-image" src="' +
            escapeHtml(image) + '" alt="' + escapeHtml(liveProduct.name) + '" draggable="false"></div>'
          ).join('');
          if (carousel && typeof carousel.owlCarousel === 'function') {
            carousel.owlCarousel({
              items: 1,
              margin: 0,
              loop: false,
              autoplay: false,
              smartSpeed: 250,
              slideBy: 1,
              dots: gallery.length > 1,
              nav: gallery.length > 1,
              navText: ['<i class="ti ti-chevron-left"></i>', '<i class="ti ti-chevron-right"></i>'],
              mouseDrag: true,
              touchDrag: true,
            });
          }
          const firstImage = $('.dynamic-product-image', slides);
          if (!firstImage || firstImage.complete) document.documentElement.classList.remove('dynamic-product-loading');
          else {
            const showProduct = () => document.documentElement.classList.remove('dynamic-product-loading');
            firstImage.addEventListener('load', showProduct, { once: true });
            firstImage.addEventListener('error', showProduct, { once: true });
          }
        }
        if (isDynamicProduct && !slides) document.documentElement.classList.remove('dynamic-product-loading');
        const videoPanel = $('.product-description > .bg-img');
        if (videoPanel) videoPanel.style.display = 'none';
        document.title = liveProduct.name + ' | Pixel House Sri Lanka';
      }
    } catch (error) {
      if (isDynamicProduct) {
        const pageContent = $('.page-content-wrapper');
        const notFound = /not found/i.test(error.message || '');
        if (pageContent) pageContent.innerHTML = '<div class="container py-5"><div class="catalog-empty-state"><h5>' +
          (notFound ? 'Product unavailable' : 'Product could not be loaded') +
          '</h5><p>' + (notFound ? 'This product may have been removed or is not currently available.' : 'Please check your connection and try again.') +
          '</p><a class="btn btn-primary" href="products.html">Browse products</a></div></div>';
        document.documentElement.classList.remove('dynamic-product-loading');
        return;
      }
    }

    // The main "Add to Cart" button on product detail pages is inside <form class="cart-form">
    const cartForm = $('.cart-form');
    if (cartForm) {
      // Fetch product to show stock status and disable add if out of stock
      try {
        const prod = liveProduct || (await get('/products/' + encodeURIComponent(slug))).product;
        const salesVolume = $('.sales-volume');
        if (salesVolume) updateStockProgress(salesVolume, prod);
        if (prod.stock != null && prod.stock <= 0) {
          // Show "Out of Stock" and disable the button
          const btn = cartForm.querySelector('button[type="submit"]');
          if (btn) { btn.textContent = 'Out of Stock'; btn.classList.add('disabled'); btn.style.opacity = '.5'; btn.style.pointerEvents = 'none'; }
          const stockInfo = document.createElement('p');
          stockInfo.style.cssText = 'color:#ef4444;font-size:13px;font-weight:600;margin-bottom:8px';
          stockInfo.innerHTML = '<i class="ti ti-alert-circle"></i> Out of Stock — Available soon';
          cartForm.querySelector('.order-plus-minus').insertAdjacentElement('afterend', stockInfo);
          const whatsApp = $('.btn-whatsapp');
          if (whatsApp) {
            whatsApp.innerHTML = '<i class="ti ti-brand-whatsapp"></i> Ask when back in stock';
            whatsApp.setAttribute('aria-label', 'Ask PixelHouse when this product is back in stock');
          }
        } else if (prod.stock != null && prod.stock < 10) {
          const stockInfo = document.createElement('p');
          stockInfo.style.cssText = 'color:#f59e0b;font-size:12px;font-weight:600;margin-bottom:8px';
          stockInfo.innerHTML = '<i class="ti ti-alert-triangle"></i> Only ' + prod.stock + ' left in stock!';
          cartForm.querySelector('.order-plus-minus').insertAdjacentElement('afterend', stockInfo);
        }
      } catch (_) {}

      cartForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const qtyInput = $('.cart-quantity-input', cartForm);
        const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value) || 1) : 1;
        try {
          const { product } = await get('/products/' + encodeURIComponent(slug));
          await post('/cart', { product_id: product.id, quantity });
          location.href = 'cart.html';
        } catch (err) { alert(err.message); }
      });
      return;
    }

    // Fallback: older templates that use an <a> tag for add-to-cart.
    // IMPORTANT: only match buttons INSIDE a product detail wrapper, not footer nav links.
    const buyBtn = $('.product-description .add-to-cart-btn, .product-description .btn-danger.btn-lg, .product-detail-wrapper .add-to-cart-btn');
    if (!buyBtn) return;
    buyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const { product } = await get('/products/' + slug);
        await post('/cart', { product_id: product.id });
        location.href = 'cart.html';
      } catch (err) { alert(err.message); }
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
  }

  function homeProductCard(product, variant) {
    if (variant === 'featured_gear') {
      const image = escapeHtml(product.image || 'img/product/1.webp');
      const name = escapeHtml(product.name);
      const href = 'single-product.html?product=' + encodeURIComponent(product.slug);
      return '<div class="card flash-sale-card"><div class="card-body"><a href="' + href + '"><img src="' + image + '" alt="' + name + '" loading="lazy" decoding="async"><span class="product-title">' + name + '</span><p class="sale-price">' + money(product.price) + (product.old_price ? '<span class="real-price">' + money(product.old_price) + '</span>' : '') + '</p></a></div></div>';
    }
    return productCardHTML(product);
  }

  async function wireHomepageSections() {
    if (page !== 'home.html') return;
    try {
      const { sections } = await get('/homepage-sections');
      Object.entries(sections || {}).forEach(([key, products]) => {
        const target = $('[data-home-products="' + key + '"]');
        if (!target || !Array.isArray(products) || !products.length) return;
        const markup = products.map((product) => homeProductCard(product, key)).join('');
        if (key === 'featured_gear' && window.jQuery && window.jQuery(target).data('owl.carousel')) {
          window.jQuery(target).trigger('replace.owl.carousel', [markup]).trigger('refresh.owl.carousel');
        } else target.innerHTML = markup;
        bindProductButtons(target);
      });
    } catch (_) { /* Keep the existing homepage cards if the section API is unavailable. */ }
  }

  function ensureStoreFooter() {
    if (page === 'admin' || page === 'admin.html' || $('.site-footer') || !$('#footerNav')) return;
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = '<div class="container"><div class="site-footer-benefits" aria-label="Store services">' +
      '<div><i class="ti ti-truck-delivery" aria-hidden="true"></i><span>Quick delivery</span></div>' +
      '<div><i class="ti ti-headset" aria-hidden="true"></i><span>24/7 support</span></div>' +
      '<div><i class="ti ti-rosette-check" aria-hidden="true"></i><span>Genuine products</span></div></div>' +
      '<section class="site-footer-reviews" aria-labelledby="footerReviewsTitle"><h2 id="footerReviewsTitle">Customer reviews</h2><div class="site-footer-review-list" data-customer-reviews><p class="site-footer-muted">Loading customer reviews…</p></div></section>' +
      '<div class="site-footer-main"><section class="site-footer-about"><img src="img/core-img/pixelhouse-footer-logo.jpg" alt="PixelHouse — GoPro cameras, accessories and camera rental" loading="lazy" decoding="async"><p>PixelHouse Sri Lanka brings together GoPro, DJI, and Insta360 cameras, accessories, rentals, and camera trade for creators and adventurers. Find genuine gear, explore reliable everyday essentials, and get friendly guidance from a local team that understands every shot and journey.</p><div class="site-footer-social" aria-label="Social media">' +
      '<a href="https://www.facebook.com/share/1CCLYiQLMy/" target="_blank" rel="noopener noreferrer" aria-label="Facebook"><i class="ti ti-brand-facebook"></i></a>' +
      '<a href="https://www.instagram.com/pixelhouse.store?stkn=Z2F5MXNtNmUweXB5" target="_blank" rel="noopener noreferrer" aria-label="Instagram"><i class="ti ti-brand-instagram"></i></a>' +
      '<a href="https://wa.me/94777466675" target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><i class="ti ti-brand-whatsapp"></i></a>' +
      '<a href="https://www.tiktok.com/@pixelhouse.store?_r=1&_t=ZS-99zFSeQAKj2" target="_blank" rel="noopener noreferrer" aria-label="TikTok"><i class="ti ti-brand-tiktok"></i></a></div></section>' +
      '<nav class="site-footer-links" aria-label="Customer policies"><h2>Customer care</h2><a href="privacy-policy.html">Privacy policy</a><a href="terms.html">Terms and conditions</a><a href="return-policy.html">Exchange and return policy</a><a href="shipping-policy.html">Shipping policy</a></nav>' +
      '<section class="site-footer-contact"><h2>Contact</h2><a href="tel:+94777466675" aria-label="Call 0777 4666 75"><i class="ti ti-phone" aria-hidden="true"></i><span>0777 4666 75</span></a><a href="mailto:contact@pixelhouse.lk" aria-label="Email contact@pixelhouse.lk"><i class="ti ti-mail" aria-hidden="true"></i><span>contact@pixelhouse.lk</span></a></section></div>' +
      '<div class="site-footer-copyright">© ' + new Date().getFullYear() + ' PixelHouse. All rights reserved.</div></div>';
    $('#footerNav').before(footer);
    get('/reviews/recent').then(({ reviews }) => {
      const list = $('[data-customer-reviews]', footer);
      if (!list) return;
      list.innerHTML = reviews && reviews.length ? reviews.map((review) => {
        const rating = Math.max(0, Math.min(5, Number(review.rating) || 0));
        return '<article class="site-footer-review"><div class="site-footer-stars" aria-label="' + rating + ' out of 5 stars">' + '★'.repeat(rating) + '☆'.repeat(5 - rating) + '</div><p>“' + escapeHtml(review.comment) + '”</p><span>' + escapeHtml(review.username || 'Customer') + ' · ' + escapeHtml(review.product_name) + '</span></article>';
      }).join('') : '<p class="site-footer-muted">No customer reviews have been published yet.</p>';
    }).catch(() => {
      const list = $('[data-customer-reviews]', footer);
      if (list) list.innerHTML = '<p class="site-footer-muted">Customer reviews are temporarily unavailable.</p>';
    });
  }

  async function wireProductReviews() {
    const slug = new URLSearchParams(location.search).get('product') || page.replace('.html', '');
    const form = $('.ratings-submit-form form');
    const list = $('.rating-review-content ul');
    if (!slug || !form || !list) return;

    const renderReviews = async () => {
      const { product, reviews } = await get('/products/' + slug);
      list.innerHTML = reviews.map((review) => (
        '<li class="single-user-review d-flex"><div class="user-thumbnail"><img src="img/bg-img/9.jpg" alt="Customer reviewer" loading="lazy" decoding="async"></div>' +
        '<div class="rating-comment"><div class="rating">' + '<i class="ti ti-star-filled"></i>'.repeat(review.rating) +
        '</div><p class="comment mb-0">' + escapeHtml(review.comment) + '</p><span class="name-date">' +
        escapeHtml(review.username) + ' · ' + escapeHtml(review.created_at) + '</span></div></li>'
      )).join('') || '<li class="single-user-review">No verified reviews yet.</li>';

      const summary = $('#productRatingSummary') || $('.product-ratings');
      if (summary) {
        const count = reviews.length;
        if (count) {
          const average = Number(product.rating || (reviews.reduce((sum, review) => sum + Number(review.rating), 0) / count));
          summary.innerHTML = '<div class="container d-flex align-items-center justify-content-between rtl-flex-d-row-r">' +
            '<div class="ratings">' + '<i class="ti ti-star-filled"></i>'.repeat(Math.round(average)) +
            '<span class="ps-1">' + count + ' verified review' + (count === 1 ? '' : 's') + '</span></div>' +
            '<div class="total-result-of-ratings"><span>' + average.toFixed(1) + '</span><span>Verified</span></div></div>';
        } else {
          summary.innerHTML = '<div class="container d-flex align-items-center justify-content-between rtl-flex-d-row-r">' +
            '<div class="ratings"><span>No verified reviews yet</span></div>' +
            '<div class="total-result-of-ratings"><span>New</span></div></div>';
        }
      }
    };

    try { await renderReviews(); } catch (_) {}
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!requireLogin()) return;
      const selectedRating = $('input[name="star"]:checked', form);
      const rating = selectedRating ? Number(selectedRating.id.replace('star', '')) : 0;
      const comment = $('textarea[name="comment"]', form).value.trim();
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        alertBox(form, 'Please select a rating.', 'danger');
        return;
      }
      try {
        await post('/products/' + slug + '/reviews', { rating, comment });
        form.reset();
        await renderReviews();
        alertBox(form, 'Your review is now live.', 'success');
      } catch (error) { alertBox(form, error.message, 'danger'); }
    });
  }

  /* ---------- live product search with suggestions ---------- */
  function initSearch() {
    const forms = $$('.search-form form');
    if (!forms.length) return;

    // Suggestion box styles (injected once)
    const style = document.createElement('style');
    style.textContent = `
      .search-suggestions{position:fixed;background:#fff;border-radius:12px;
        box-shadow:0 10px 30px rgba(0,0,0,.28);z-index:2000;max-height:320px;overflow-y:auto;display:none}
      .search-suggestions a{display:flex;align-items:center;gap:10px;padding:10px 14px;color:#1f0755;text-decoration:none;border-bottom:1px solid #f0eefc}
      .search-suggestions a:last-child{border-bottom:none}
      .search-suggestions a:hover,.search-suggestions a.active{background:#f4f3ff}
      .search-suggestions img{width:38px;height:38px;object-fit:contain;border-radius:6px;background:#faf9ff}
      .search-suggestions .ss-name{flex:1;font-size:13px;font-weight:600}
      .search-suggestions .ss-price{font-size:12px;color:#625AFA;font-weight:700;white-space:nowrap}
      .search-suggestions .ss-empty{padding:12px 14px;font-size:13px;color:#888}
      .search-form form{position:relative}
    `;
    document.head.appendChild(style);

    let products = null; // lazy-loaded once
    async function loadProducts() {
      if (products) return products;
      try {
        const { products: list } = await get('/products');
        products = list;
      } catch (_) { products = []; }
      return products;
    }

    forms.forEach((form) => {
      const input = $('input[type="search"]', form);
      if (!input) return;
      form.setAttribute('autocomplete', 'off');

      // Attach the dropdown to <body> with position:fixed so NOTHING can cover it
      // (sliders and category cards create their own stacking layers — a dropdown
      // inside the search bar would be capped by the search bar's z-index)
      const box = document.createElement('div');
      box.className = 'search-suggestions';
      document.body.appendChild(box);

      function placeBox() {
        const r = input.getBoundingClientRect();
        box.style.top = (r.bottom + 4) + 'px';
        box.style.left = r.left + 'px';
        box.style.width = r.width + 'px';
      }
      window.addEventListener('scroll', placeBox, { passive: true });
      window.addEventListener('resize', placeBox);

      function hide() { box.style.display = 'none'; }
      function show(matches) {
        if (!matches.length) {
          box.innerHTML = '<div class="ss-empty">No products found. Try "stick", "case", "kit"...</div>';
        } else {
          box.innerHTML = matches.map((p) =>
            `<a href="single-product.html?product=${encodeURIComponent(p.slug)}" data-slug="${escapeHtml(p.slug)}">` +
              `<img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}">` +
              `<span class="ss-name">${escapeHtml(p.name)}</span>` +
              `<span class="ss-price">${money(p.price)}</span>` +
            '</a>'
          ).join('');
        }
        placeBox();
        box.style.display = 'block';
      }

      input.addEventListener('input', async () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { hide(); return; }
        const list = await loadProducts();
        const words = q.split(/\s+/).filter(Boolean);
        const matches = list.filter((p) =>
          words.every((w) => p.name.toLowerCase().includes(w))
        ).slice(0, 6);
        show(matches);
      });

      // Submit (Enter or search icon) → go to the best matching product page
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const q = input.value.trim().toLowerCase();
        if (!q) return;
        const list = await loadProducts();
        const words = q.split(/\s+/).filter(Boolean);
        const match = list.find((p) => words.every((w) => p.name.toLowerCase().includes(w)))
                   || list.find((p) => words.some((w) => p.name.toLowerCase().includes(w)));
        if (match) location.href = 'single-product.html?product=' + encodeURIComponent(match.slug);
        else { input.value = ''; input.placeholder = 'No product found — try again'; }
      });

      input.addEventListener('blur', () => setTimeout(hide, 200));
      input.addEventListener('focus', () => { if (box.innerHTML) { placeBox(); box.style.display = 'block'; } });
    });
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    // Force-remove the preloader immediately — don't wait for window.onload
    // which only fires after ALL images/fonts load (can take a long time)
    var pl = document.getElementById('preloader');
    if (pl) pl.style.display = 'none';

    ensureStoreFooter();

    // Start catalog and product requests immediately instead of waiting for
    // the session check, so newly added products can render sooner.
    wireCategoryCatalog().catch(() => {});
    wireProductDetail().catch(() => {});
    wireHomepageSections().catch(() => {});
    await loadSession();
    if (wiring[page]) await wiring[page]();
    hideRemovedCatalogCards();
    wireProductReviews();
    updateFlashSaleStockBars();
    bindProductButtons(document);
    initSearch();
  });
})();
