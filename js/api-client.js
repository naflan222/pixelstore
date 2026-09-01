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

  const money = (n) => 'Rs. ' + Number(n).toLocaleString('en-US');
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

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
    const badge = p.badge ? '<span class="badge rounded-pill badge-warning">' + p.badge + '</span>' : '';
    const old = p.old_price ? '<span>' + money(p.old_price) + '</span>' : '';
    return (
      '<div class="col-6 col-md-4">' +
        '<div class="card product-card">' +
          '<div class="card-body">' +
            badge +
            '<a class="wishlist-btn" href="#" data-wishlist-id="' + p.id + '"><i class="ti ti-heart"></i></a>' +
            '<a class="product-thumbnail d-block" href="' + p.slug + '.html"><img class="mb-2" src="' + p.image + '" alt=""></a>' +
            '<a class="product-title" href="' + p.slug + '.html">' + p.name + '</a>' +
            '<p class="sale-price">' + money(p.price) + old + '</p>' +
            '<div class="product-rating"><i class="ti ti-star-filled"></i>' + p.rating + '</div>' +
            '<a class="btn btn-success btn-sm" href="#" data-cart-id="' + p.id + '"><i class="ti ti-plus"></i></a>' +
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
        if (!slug || slug === '#') return;
        try {
          await post('/cart/by-slug', { slug });
          el.innerHTML = '<i class="ti ti-check"></i>';
          setTimeout(() => { el.innerHTML = '<i class="ti ti-plus"></i>'; }, 1500);
          refreshCartBadge();
        } catch (err) { alert(err.message); }
      });
    });
    $$('[data-wishlist-id]', root).forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const r = await post('/wishlist', { product_id: Number(el.dataset.wishlistId) });
          el.style.color = r.added ? '#ea4c62' : '';
        } catch (err) { alert(err.message); }
      });
    });
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
          sessionStorage.setItem('last_order', JSON.stringify({ order_id: r.order_id, total: r.total }));
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
  async function loadSession() {
    try {
      const data = await get('/auth/me');
      currentUser = data.user;
      // Sidenav identity
      const name = $('.sidenav-profile .user-name');
      if (name) name.textContent = currentUser.full_name || currentUser.username;
      const bal = $('.sidenav-profile .available-balance .counter');
      if (bal) bal.textContent = currentUser.balance;
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
            location.href = 'intro.html';
          });
        }
      });
    } catch (_) {
      currentUser = null;
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
        try {
          const r = await post('/auth/register', {
            username: $('#username').value.trim(),
            email: $('#email').value.trim(),
            password: $('#registerPassword').value,
          });
          location.href = r.redirect || 'home.html';
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'forget-password.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      const input = $('input[type="email"], input[type="text"]', form);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const r = await post('/auth/forgot-password', { email: input.value.trim() });
          sessionStorage.setItem('reset_email', input.value.trim());
          alertBox(form, r.message + (r.dev_code ? ' Code: ' + r.dev_code : ''), 'success');
          setTimeout(() => { location.href = 'otp-confirm.html'; }, 1500);
        } catch (err) { alertBox(form, err.message); }
      });
    },

    'otp-confirm.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = $$('input', form).map((i) => i.value.trim()).join('').replace(/\s/g, '');
        sessionStorage.setItem('reset_code', code);
        location.href = 'change-password.html';
      });
    },

    'change-password.html': function () {
      const form = $('form');
      if (!form) return;
      form.removeAttribute('action');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inputs = $$('input[type="password"]', form);
        const email = sessionStorage.getItem('reset_email');
        const code = sessionStorage.getItem('reset_code');
        try {
          if (email && code) {
            const r = await post('/auth/reset-password', {
              email, code, password: inputs[0].value,
            });
            sessionStorage.removeItem('reset_email');
            sessionStorage.removeItem('reset_code');
            location.href = r.redirect || 'forget-password-success.html';
          } else {
            if (!requireLogin()) return;
            await post('/auth/change-password', {
              current_password: inputs[0].value,
              new_password: inputs[1] ? inputs[1].value : inputs[0].value,
            });
            alertBox(form, 'Password changed successfully.', 'success');
          }
        } catch (err) { alertBox(form, err.message); }
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
      const tbody = $('.cart-table tbody');
      if (!tbody) return;
      const totalWrap = $('.cart-amount-area'); // contains the "Rs. 38.84" demo number
      // Hide the demo total IMMEDIATELY so it never flashes before real data loads
      if (totalWrap) totalWrap.style.display = 'none';
      let data;
      try { data = await get('/cart'); } catch (err) { return; }

      function render(items) {
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">Your cart is empty. <a href="shop-grid.html">Shop now</a></td></tr>';
          // Hide the total bar so the stale demo number never shows on an empty cart
          if (totalWrap) totalWrap.style.display = 'none';
        } else {
          if (totalWrap) totalWrap.style.display = '';
          tbody.innerHTML = items.map((i) => (
            '<tr>' +
              '<th scope="row"><a class="remove-product" href="#" data-remove="' + i.cart_id + '"><i class="ti ti-x"></i></a></th>' +
              '<td><img class="rounded" src="' + i.image + '" alt=""></td>' +
              '<td><a class="product-title" href="' + i.slug + '.html">' + i.name +
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
            '<input class="form-control" id="billName" type="text" placeholder="Your full name" value="' + billing.name + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-mail"></i><span>Email Address</span></div>' +
            '<input class="form-control" id="billEmail" type="email" placeholder="you@example.com" value="' + billing.email + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-phone"></i><span>Phone Number</span></div>' +
            '<input class="form-control" id="billPhone" type="text" placeholder="07X XXX XXXX" value="' + billing.phone + '"></div>' +
          '<div class="mb-3"><div class="title mb-2"><i class="ti ti-location"></i><span>Shipping Address</span></div>' +
            '<input class="form-control" id="billAddress" type="text" placeholder="Street, City" value="' + billing.address + '"></div>' +
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
        fastShipping: { method: 'express', fee: 500 },
        normalShipping: { method: 'standard', fee: 250 },
        courier: { method: 'pickup', fee: 0 },
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
        return SHIPPING[checked ? checked.id : 'normalShipping'] || SHIPPING.normalShipping;
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
    'checkout-credit-card.html': placeOrderPage('credit-card'),
    'checkout-bank.html': placeOrderPage('bank'),
    'checkout-paypal.html': placeOrderPage('paypal'),

    // --- Success page: show the order number and total that was just placed ---
    'payment-success.html': function () {
      const info = sessionStorage.getItem('last_order');
      if (!info) return;
      try {
        const { order_id, total } = JSON.parse(info);
        const p = $('.order-success-wrapper p');
        if (p) p.innerHTML = 'Order <strong>#' + order_id + '</strong> placed — Total <strong>' + money(total) + '</strong>.<br>We will notify you of all the details via email. Thank you!';
        sessionStorage.removeItem('last_order');
      } catch (_) {}
    },

    'wishlist-grid.html': async function () { await renderWishlist('.row', productCardHTML); },
    'wishlist-list.html': async function () {
      await renderWishlist('.row', (p) => (
        '<div class="col-12"><div class="card product-card"><div class="card-body">' +
          '<a class="product-thumbnail d-block" href="' + p.slug + '.html"><img class="mb-2" src="' + p.image + '" alt=""></a>' +
          '<a class="product-title" href="' + p.slug + '.html">' + p.name + '</a>' +
          '<p class="sale-price">' + money(p.price) + (p.old_price ? '<span>' + money(p.old_price) + '</span>' : '') + '</p>' +
          '<div class="product-rating"><i class="ti ti-star-filled"></i>' + p.rating + '</div>' +
          '<a class="btn btn-success btn-sm" href="#" data-cart-id="' + p.id + '"><i class="ti ti-plus"></i></a>' +
        '</div></div></div>'
      ));
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
            '<span class="badge badge-' + (o.status === 'pending' ? 'warning' : 'success') + '">' + o.status + '</span></div>' +
            '<p class="mb-1 text-muted" style="font-size:12px">' + o.created_at + ' · ' + o.payment_method + '</p>' +
            o.items.map((i) => '<div class="d-flex justify-content-between" style="font-size:13px"><span>' + i.name + ' × ' + i.quantity + '</span><span>' + money(i.price * i.quantity) + '</span></div>').join('') +
            '<hr><div class="d-flex justify-content-between"><strong>Total</strong><strong>' + money(o.total) + '</strong></div>' +
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
            '<h6 class="mb-1">' + n.title + '</h6>' +
            '<p class="mb-1" style="font-size:13px">' + n.body + '</p>' +
            '<small class="text-muted">' + n.created_at + '</small>' +
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
      if (!currentUser) return; // guests see the page as-is
      const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
      set('profileUsername', '@' + currentUser.username);
      set('profileFullName', (currentUser.full_name || '').toUpperCase() || currentUser.username.toUpperCase());
      set('profilePhone', currentUser.phone);
      // Email row has no id — fill by position among the profile data rows
      const rows = $$('.profile-wrapper-area .single-profile-data .data-content, .user-data-card .single-profile-data .data-content');
      rows.forEach((el) => {
        if (el.previousElementSibling && /Email/.test(el.previousElementSibling.textContent)) {
          el.textContent = currentUser.email;
        }
      });
      // Profile header name
      const headerName = $('.user-info h5, .profile-info h5');
      if (headerName && (currentUser.full_name || currentUser.username)) headerName.textContent = currentUser.full_name || currentUser.username;
    },

    'featured-products.html': async function () { await renderProductGrid({ featured: '1' }); },
    'flash-sale.html': async function () { await renderProductGrid({ flash_sale: '1' }); },
  };

  async function renderWishlist(selector, tpl) {
    const row = $(selector);
    if (!row || !currentUser) return;
    try {
      const { items } = await get('/wishlist');
      if (!items.length) return;
      row.innerHTML = items.map((p) => tpl({ ...p, rating: p.rating || 4.5 })).join('');
      bindProductButtons(row);
    } catch (_) {}
  }

  async function renderProductGrid(query) {
    const grid = $('.flash-sale-wrapper .row, .featured-products-wrapper .row, .top-products-area .row, .page-content-wrapper .row.g-3');
    if (!grid) return;
    try {
      const qs = new URLSearchParams(query).toString();
      const { products } = await get('/products?' + qs);
      if (!products.length) return;
      grid.innerHTML = products.map(productCardHTML).join('');
      bindProductButtons(grid);
    } catch (_) {}
  }

  /* ---------- product detail pages: wire "Add to Cart" ---------- */
  function wireProductDetail() {
    const slug = page.replace('.html', '');
    if (!slug || page === 'index.html') return;

    // The main "Add to Cart" button on product detail pages is inside <form class="cart-form">
    const cartForm = $('.cart-form');
    if (cartForm) {
      cartForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const qtyInput = $('.cart-quantity-input', cartForm);
        const quantity = qtyInput ? Math.max(1, parseInt(qtyInput.value) || 1) : 1;
        try {
          const { product } = await get('/products/' + slug);
          await post('/cart', { product_id: product.id, quantity });
          location.href = 'cart.html';
        } catch (err) { alert(err.message); }
      });
      return;
    }

    // Fallback: older templates that use an <a> tag for add-to-cart
    const buyBtn = $('a[href="cart.html"], .add-to-cart-btn, .btn-danger.btn-lg');
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
            `<a href="${p.slug}.html" data-slug="${p.slug}">` +
              `<img src="${p.image}" alt="">` +
              `<span class="ss-name">${p.name}</span>` +
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
        if (match) location.href = match.slug + '.html';
        else { input.value = ''; input.placeholder = 'No product found — try again'; }
      });

      input.addEventListener('blur', () => setTimeout(hide, 200));
      input.addEventListener('focus', () => { if (box.innerHTML) { placeBox(); box.style.display = 'block'; } });
    });
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    await loadSession();
    if (wiring[page]) await wiring[page]();
    wireProductDetail();
    bindProductButtons(document);
    initSearch();
  });
})();
