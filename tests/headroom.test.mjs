import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHeadroomSummary } from '../src/core/headroom.mjs';

test('returns unconfigured state when no mandate is present', () => {
  const summary = computeHeadroomSummary(null, 0, 0, []);
  assert.equal(summary.health, 'unconfigured');
  assert.equal(summary.budgetCents, 0);
  assert.equal(summary.availableCents, 0);
  assert.equal(summary.utilizationPct, 0);
  assert.equal(summary.availablePct, 100);
  assert.deepEqual(summary.categories, []);
});

test('computes captured, reserved and available segments accurately for active mandate', () => {
  const mandate = {
    version: 2,
    active: true,
    budgetCents: 30000,
    maxPurchaseCents: 25000,
    maxQuantity: 8,
    categories: ['keyboards', 'mice'],
    categoryLimits: { keyboards: 5, mice: 4 },
  };
  const intents = [
    {
      id: 'i1',
      status: 'captured',
      quantity: 5,
      totalCents: 24500,
      quote: { category: 'keyboards' },
    },
    {
      id: 'i2',
      status: 'reserved',
      quantity: 3,
      totalCents: 4200,
      quote: { category: 'mice' },
    },
    {
      id: 'i3',
      status: 'canceled',
      quantity: 5,
      totalCents: 24500,
      quote: { category: 'keyboards' },
    },
  ];

  const summary = computeHeadroomSummary(mandate, 24500, 4200, intents);
  assert.equal(summary.availableCents, 1300);
  assert.equal(summary.overBudgetCents, 0);
  assert.equal(summary.spentPct, 81.7);
  assert.equal(summary.reservedPct, 14);
  assert.equal(summary.availablePct, 4.3);
  assert.equal(summary.utilizationPct, 96);
  assert.equal(summary.health, 'critical');

  const keyboards = summary.categories.find(c => c.category === 'keyboards');
  const mice = summary.categories.find(c => c.category === 'mice');
  assert.equal(keyboards.capturedCents, 24500);
  assert.equal(keyboards.reservedCents, 0);
  assert.equal(keyboards.unitsUsed, 5);
  assert.equal(keyboards.unitLimit, 5);
  assert.equal(mice.capturedCents, 0);
  assert.equal(mice.reservedCents, 4200);
  assert.equal(mice.unitsUsed, 3);
  assert.equal(mice.unitLimit, 4);
});

test('splits mixed basket intents across categories and handles lowered budget safely', () => {
  const mandate = {
    version: 3,
    active: true,
    budgetCents: 20000,
    maxPurchaseCents: 20000,
    maxQuantity: 10,
    categories: ['keyboards', 'mice'],
  };
  const intents = [
    {
      id: 'basket-1',
      status: 'captured',
      quantity: 8,
      totalCents: 28700,
      lines: [
        { quantity: 5, product: { id: 'hush-75', category: 'keyboards', unitPriceCents: 4900, shippingCents: 0, taxCents: 0 } },
        { quantity: 3, product: { id: 'desk-mouse', category: 'mice', unitPriceCents: 1400, shippingCents: 0, taxCents: 0 } },
      ],
    },
  ];

  const summary = computeHeadroomSummary(mandate, 28700, 0, intents);
  assert.equal(summary.availableCents, 0);
  assert.equal(summary.overBudgetCents, 8700);
  assert.equal(summary.utilizationPct, 100);
  assert.equal(summary.spentPct, 100);
  assert.equal(summary.availablePct, 0);
  assert.equal(summary.health, 'critical');

  const keyboards = summary.categories.find(c => c.category === 'keyboards');
  const mice = summary.categories.find(c => c.category === 'mice');
  assert.equal(keyboards.capturedCents, 24500);
  assert.equal(keyboards.unitsUsed, 5);
  assert.equal(mice.capturedCents, 4200);
  assert.equal(mice.unitsUsed, 3);
});

test('reflects warning and inactive states properly', () => {
  const mandate = { version: 1, active: true, budgetCents: 10000, maxQuantity: 5, categories: ['webcams'] };
  const warningSummary = computeHeadroomSummary(mandate, 7000, 0, []);
  assert.equal(warningSummary.health, 'warning');
  assert.equal(warningSummary.utilizationPct, 70);

  const inactiveSummary = computeHeadroomSummary({ ...mandate, active: false }, 2000, 0, []);
  assert.equal(inactiveSummary.health, 'inactive');
});
