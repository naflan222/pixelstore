const test = require('node:test');
const assert = require('node:assert/strict');
const { nextDeadline, remainingParts, start } = require('../js/monthly-cycle');

test('a shared monthly deadline survives reloads and automatically advances at expiry', () => {
  const anchor = '2026-11-08T00:00:00Z';
  assert.equal(new Date(nextDeadline(anchor, Date.parse('2026-11-08T12:00:00Z'))).toISOString(), '2026-12-08T00:00:00.000Z');
  assert.equal(nextDeadline(anchor, Date.parse('2026-11-09T00:00:00Z')), nextDeadline(anchor, Date.parse('2026-12-01T00:00:00Z')));
  assert.equal(new Date(nextDeadline(anchor, Date.parse('2026-12-08T00:00:00Z'))).toISOString(), '2027-01-08T00:00:00.000Z');
  assert.equal(new Date(nextDeadline(anchor, Date.parse('2027-05-10T00:00:00Z'))).toISOString(), '2027-06-08T00:00:00.000Z');
});

test('calendar months handle month ends and leap years without drifting', () => {
  assert.equal(new Date(nextDeadline('2027-01-31T10:30:00Z', Date.parse('2027-02-01T00:00:00Z'))).toISOString(), '2027-02-28T10:30:00.000Z');
  assert.equal(new Date(nextDeadline('2027-01-31T10:30:00Z', Date.parse('2027-02-28T10:30:00Z'))).toISOString(), '2027-03-31T10:30:00.000Z');
  assert.equal(new Date(nextDeadline('2028-01-31T00:00:00Z', Date.parse('2028-02-01T00:00:00Z'))).toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(nextDeadline('bad date'), null);
});

test('timer renders immediately and renews after a suspended tab crosses the deadline', () => {
  const values = Object.fromEntries(['days', 'hours', 'minutes', 'seconds'].map(key => [key, { textContent: '' }]));
  let label, tick, interval;
  let now = Date.parse('2026-12-07T23:59:59Z');
  const element = { getAttribute: () => '2026-11-08T00:00:00Z', querySelector: selector => values[selector.slice(1)],
    setAttribute: (_name, value) => { label = value; } };
  const document = { querySelector: () => element, querySelectorAll: () => [element] };
  start(document, () => now, (callback, ms) => { tick = callback; interval = ms; return 1; });
  assert.equal(values.seconds.textContent, '01');
  assert.equal(interval, 1000);
  now = Date.parse('2027-01-10T10:00:00Z');
  tick();
  assert.equal(values.days.textContent, '28');
  assert.match(label, /Renews automatically/);
  assert.ok(Object.values(values).some(value => value.textContent !== '00'));
  assert.deepEqual(remainingParts(90061000, 0), { days: '01', hours: '01', minutes: '01', seconds: '01' });
});
