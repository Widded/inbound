const test = require('node:test');
const assert = require('node:assert');
const googleSheetsService = require('../src/sheets/googleSheets');

test('GoogleSheetsService exports valid methods', async () => {
  assert.ok(googleSheetsService);
  assert.strictEqual(typeof googleSheetsService.updateDriverEtaInSheet, 'function');
  assert.strictEqual(typeof googleSheetsService.clearAllEtasInSheet, 'function');
});
