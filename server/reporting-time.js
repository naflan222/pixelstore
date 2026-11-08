'use strict';
const ZONES = new Set(['UTC', 'Asia/Colombo']);
function timezone(value = 'UTC') {
  const zone = String(value);
  if (!ZONES.has(zone)) throw new Error('Unsupported reporting timezone.');
  return zone;
}
function localDate(date = new Date(), zone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone(zone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function utcBoundary(day, zone = 'UTC') {
  const offset = timezone(zone) === 'Asia/Colombo' ? '+05:30' : 'Z';
  const value = new Date(`${day}T00:00:00${offset}`);
  if (Number.isNaN(value.getTime())) throw new Error('Invalid report date.');
  return value.toISOString().slice(0, 19).replace('T', ' ');
}
module.exports = { timezone, localDate, utcBoundary };
