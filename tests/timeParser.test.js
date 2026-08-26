const test = require('node:test');
const assert = require('node:assert');
const { parseTurkishTime } = require('../src/utils/timeParser');

test('Turkish Time Parser - parses HH:MM and HH.MM correctly', () => {
  assert.strictEqual(parseTurkishTime('16:30'), '16:30');
  assert.strictEqual(parseTurkishTime('17.00'), '17:00');
  assert.strictEqual(parseTurkishTime('5:30'), '17:30');
});

test('Turkish Time Parser - parses single digit hours as afternoon PM format', () => {
  assert.strictEqual(parseTurkishTime('saat 5 gibi'), '17:00');
  assert.strictEqual(parseTurkishTime('5'), '17:00');
  assert.strictEqual(parseTurkishTime('5 de'), '17:00');
  assert.strictEqual(parseTurkishTime('7'), '19:00');
});

test('Turkish Time Parser - returns null for non-time text', () => {
  assert.strictEqual(parseTurkishTime('merhaba naber'), null);
});
