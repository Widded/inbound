const test = require('node:test');
const assert = require('node:assert');
const { parseTurkishTime } = require('../src/utils/timeParser');

test('Server utilities and modules load correctly', () => {
  assert.strictEqual(parseTurkishTime('16:30'), '16:30');
});
