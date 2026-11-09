(function () {
  'use strict';
  const endpoint = '/api/admin/catalog-batches/accessories-20261109';
  const message = document.getElementById('message');
  const apply = document.getElementById('apply');
  const rollback = document.getElementById('rollback');
  const confirmed = document.getElementById('confirmed');
  let state = 'loading', busy = false;
  const text = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
  async function request(path, method = 'GET') {
    const response = await fetch(endpoint + path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify({ confirm: true }) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not complete the request.');
    return result;
  }
  function controls() {
    apply.disabled = busy || !confirmed.checked || state !== 'not_applied';
    rollback.hidden = state !== 'applied'; rollback.disabled = busy;
    document.getElementById('approval').hidden = state !== 'not_applied';
    apply.hidden = state !== 'not_applied';
  }
  async function refresh() {
    const result = await request(''); state = result.state;
    document.getElementById('products').innerHTML = result.products.map(p => '<article class="product"><a href="/' + text(p.zoom_image) + '" target="_blank" rel="noopener"><img src="/' + text(p.image) + '" alt="Illustration: ' + text(p.name) + '"></a><h2>' + p.number + '. ' + text(p.name) + '</h2><p class="price">Rs. ' + Number(p.price).toLocaleString('en-LK') + '</p><p>Out of stock · Generic</p><p class="muted">' + text(p.description) + '</p><a target="_blank" rel="noopener" href="' + text(p.reference_url) + '">Check reference item</a></article>').join('');
    message.textContent = state === 'applied' ? 'Added. The products are available in website search, categories and the admin app. Enter quantities when stock arrives.' : state === 'rolled back' ? 'This batch is hidden. Manage its products individually in the admin panel.' : 'Ready for your review. Nothing has been added to the catalog yet.';
    controls();
  }
  confirmed.addEventListener('change', controls);
  apply.addEventListener('click', async () => {
    if (apply.disabled) return; busy = true; controls(); message.textContent = 'Adding the reviewed catalog…';
    try { await request('/apply', 'POST'); await refresh(); }
    catch(e) { message.textContent = e.message + ' Refresh this page to check status before retrying.'; }
    finally { busy = false; controls(); }
  });
  rollback.addEventListener('click', async () => {
    if (!window.confirm('Hide only the products created by this batch? Existing products and all order history will be preserved.')) return;
    busy = true; controls();
    try { await request('/rollback', 'POST'); await refresh(); }
    catch(e) { message.textContent = e.message + ' Refresh to check status.'; }
    finally { busy = false; controls(); }
  });
  refresh().catch(() => { message.textContent = 'Sign in with the PixelHouse owner account, then reload this page. Only the owner can review and add this batch.'; document.getElementById('login').hidden = false; });
})();
