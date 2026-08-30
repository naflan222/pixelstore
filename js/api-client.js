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
    $$('[data-cart-id]', root).forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!requireLogin()) return;
        try {
          await post('/cart', { product_id: Number(el.dataset.cartId) });
          el.innerHTML = '<i class="ti ti-check"></i>';
          setTimeout(() => { el.innerHTML = '<i class="ti ti-plus"></i>'; }, 1500);
        } catch (err) { alert(err.message); }
      });
    });
    $$('[data-wishlist-id]', root).forEach((el) => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!requireLogin()) return;
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
      if (!currentUser) { location.href = 'login.html'; return; }
      const btn = $('a[href="payment-success.html"]');
      if (!btn) return;
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        btn.classList.add('disabled');
        btn.textContent = 'Placing order...';
        try {
          const r = await post('/orders', {
            full_name: currentUser.full_name || currentUser.username,
            email: currentUser.email,
            phone: currentUser.phone || 'N/A',
            address: currentUser.address || 'N/A',
            shipping_method: sessionStorage.getItem('shipping_method') || 'standard',
            payment_method: paymentMethod,
          });
          sessionStorage.setItem('last_order', JSON.stringify({ order_id: r.order_id, total: r.total }));
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
      $$('.cart-count, [data-cart-count]').forEach((el) => { el.textContent = data.cart_count; });
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
    }
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
      if (!currentUser) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">Please <a href="login.html">log in</a> to view your cart.</td></tr>';
        return;
      }
      let data;
      try { data = await get('/cart'); } catch (err) { return; }

      function render(items) {
        if (!items.length) {
          tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">Your cart is empty. <a href="shop-grid.html">Shop now</a></td></tr>';
        } else {
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
        const totalEl = $('.cart-amount-area .counter');
        if (totalEl) totalEl.textContent = subtotal.toLocaleString('en-US');

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
      }
      render(data.items);
    },

    'checkout.html': async function () {
      if (!currentUser) { location.href = 'login.html'; return; }
      // Fill billing card from the logged-in profile
      const dc = $$('.billing-information-card .data-content');
      if (dc.length >= 4) {
        dc[0].textContent = (currentUser.full_name || currentUser.username).toUpperCase();
        dc[1].textContent = currentUser.email;
        dc[2].textContent = currentUser.phone || '—';
        dc[3].textContent = currentUser.address || '—';
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
        const totalEl = $('.cart-amount-area .counter');
        if (totalEl) totalEl.textContent = (subtotal + selectedShipping().fee).toLocaleString('en-US');
      }
      $$('input[name="selector"]').forEach((r) => r.addEventListener('change', updateTotal));
      updateTotal();

      // "Confirm & Pay" → go to payment-method page, remembering the choice
      $$('a[href="checkout-payment.html"]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          if (!subtotal) { alert('Your cart is empty.'); return; }
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
    const buyBtn = $('a[href="cart.html"], .add-to-cart-btn, .btn-danger.btn-lg');
    if (!buyBtn) return;
    buyBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!requireLogin()) return;
      try {
        const { product } = await get('/products/' + slug);
        await post('/cart', { product_id: product.id });
        location.href = 'cart.html';
      } catch (err) { alert(err.message); }
    });
  }

  /* ---------- boot ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    await loadSession();
    if (wiring[page]) await wiring[page]();
    wireProductDetail();
    bindProductButtons(document);
  });
})();
