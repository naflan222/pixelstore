// One source for the delivery choices shown to customers and charged at checkout.
function checkoutSettings(row) {
  let delivery = [];
  let payments = [];
  try { delivery = JSON.parse(row && row.delivery_options || '[]'); } catch (_) {}
  try { payments = JSON.parse(row && row.payment_methods || '[]'); } catch (_) {}
  if (!Array.isArray(delivery)) delivery = [];
  if (!Array.isArray(payments)) payments = [];
  const definitions = [
    { method: 'standard', label: 'Standard Shipping' },
    { method: 'express', label: 'Express Shipping' },
    { method: 'pickup', label: 'Store Pickup' },
  ];
  const options = definitions.flatMap(({ method, label }) => {
    const configured = delivery.find(option => option && option.method === method);
    // The admin settings form has no pickup toggle and historically omits it
    // when saving. Preserve free pickup unless it is explicitly disabled.
    if (method === 'pickup') {
      return configured && configured.enabled === false ? [] : [{ method, label, fee: 0 }];
    }
    if (!configured || configured.enabled !== true) return [];
    const rawFee = method === 'standard' ? row.shipping_fee : configured.fee;
    const fee = Number(rawFee);
    if (rawFee === null || rawFee === undefined || !Number.isFinite(fee) || fee < 0) return [];
    return [{ method, label, fee: Math.round(fee * 100) / 100 }];
  });
  return {
    store_open: Boolean(row && row.store_status === 'open'),
    delivery_options: options,
    payment_methods: payments.filter(method => ['cash', 'bank'].includes(method)),
  };
}

module.exports = { checkoutSettings };
