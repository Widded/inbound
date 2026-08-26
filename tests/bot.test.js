const test = require('node:test');
const assert = require('node:assert');
const { connectToWhatsApp } = require('../src/whatsapp/bot');

test('WhatsApp module exports connectToWhatsApp function', () => {
  assert.strictEqual(typeof connectToWhatsApp, 'function');
});
