(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.PixelHouseMonthlyCycle = api;
    const start = () => api.start(root.document);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function nextDeadline(anchorValue, nowValue = Date.now()) {
    const anchor = new Date(anchorValue);
    const now = new Date(nowValue);
    if (Number.isNaN(anchor.getTime()) || Number.isNaN(now.getTime())) return null;
    const boundary = offset => {
      const month = anchor.getUTCMonth() + offset;
      const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0)).getUTCDate();
      return Date.UTC(anchor.getUTCFullYear(), month, Math.min(anchor.getUTCDate(), lastDay),
        anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds());
    };
    let offset = Math.max(1, (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth());
    let deadline = boundary(offset);
    while (deadline <= now.getTime()) deadline = boundary(++offset);
    return deadline;
  }

  function remainingParts(deadline, now = Date.now()) {
    const seconds = Math.max(0, Math.floor((deadline - now) / 1000));
    const pad = value => String(value).padStart(2, '0');
    return { days: pad(Math.floor(seconds / 86400)), hours: pad(Math.floor(seconds / 3600) % 24),
      minutes: pad(Math.floor(seconds / 60) % 60), seconds: pad(seconds % 60) };
  }

  function start(document, clock = () => Date.now(), schedule = setInterval) {
    const selector = '[data-monthly-countdown]';
    if (!document.querySelector(selector)) return null;
    const tick = () => {
      const now = clock();
      document.querySelectorAll(selector).forEach(element => {
        const deadline = nextDeadline(element.getAttribute('data-monthly-countdown'), now);
        if (deadline === null) return;
        const parts = remainingParts(deadline, now);
        Object.entries(parts).forEach(([name, value]) => {
          const target = element.querySelector('.' + name);
          if (target) target.textContent = value;
        });
        element.setAttribute('aria-label', 'Monthly refresh: ' + Number(parts.days) + ' days ' + parts.hours + ' hours remaining. Renews automatically each month.');
      });
    };
    tick();
    return schedule(tick, 1000);
  }

  return { nextDeadline, remainingParts, start };
});
