import test from 'node:test';
import assert from 'node:assert/strict';
import { safeCsvCell } from '../src/core/csv.mjs';

test('untrusted spreadsheet formulas are exported as text', () => {
  for (const value of ['=HYPERLINK("bad")', ' +SUM(1,2)', '-1+2', '@SUM(1)', '\tformula', '\rformula', '\n=1', '\u0000=1']) {
    assert.equal(safeCsvCell(value), `'${value}`);
  }
  for (const value of ['PayPal confirmed', '245.00', 'Order, "quoted"', '']) assert.equal(safeCsvCell(value), value);
  assert.equal(safeCsvCell(null), '');
});
