import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/server/store.mjs';
import { createService } from '../src/server/service.mjs';
import { catalog } from '../src/core/catalog.mjs';
import { computeSpendForecast, simulatePolicy } from '../src/core/simulator.mjs';

test('computeSpendForecast calculates exact order exhaustion and remaining headroom', () => {
  const forecast = computeSpendForecast({
    budgetCents: 30000,
    maxPurchaseCents: 26000,
    maxQuantity: 5,
    alreadyCommittedCents: 0,
    unitPriceCents: 4900,
    quantity: 5,
    periods: 4,
  });
  assert.equal(forecast.orderCostCents, 24500);
  assert.equal(forecast.affordableOrders, 1);
  assert.equal(forecast.exhaustionOrder, 2);
  assert.equal(forecast.endingRemainingCents, 5500);
  assert.equal(forecast.steps[0].allowed, true);
  assert.equal(forecast.steps[0].remainingAfterCents, 5500);
  assert.equal(forecast.steps[1].allowed, false);
  assert.ok(forecast.steps[1].reasons.includes('BUDGET_EXCEEDED'));
});

test('computeSpendForecast catches per-order cap and max quantity blocks on Order #1', () => {
  const forecast = computeSpendForecast({
    budgetCents: 30000,
    maxPurchaseCents: 10000,
    maxQuantity: 4,
    unitPriceCents: 4900,
    quantity: 5,
    periods: 3,
  });
  assert.equal(forecast.affordableOrders, 0);
  assert.equal(forecast.exhaustionOrder, 1);
  assert.ok(forecast.steps[0].reasons.includes('QUANTITY_NOT_ALLOWED'));
  assert.ok(forecast.steps[0].reasons.includes('PURCHASE_LIMIT_EXCEEDED'));
});

test('simulatePolicy replays historical purchases and quantifies catalog risk reduction', () => {
  const now = 1794000000000;
  const baseline = {
    active: true, expiresAt: now + 86400000, requireApproval: true, currency: 'USD',
    merchantIds: ['buywise-sandbox'], categories: ['keyboards', 'mice'], categoryLimits: {},
    maxQuantity: 5, budgetCents: 30000, maxPurchaseCents: 30000,
  };
  const tighterCandidate = {
    name: 'Tighter Cap', active: true, expiresAt: now + 86400000, requireApproval: true, currency: 'USD',
    merchantIds: ['buywise-sandbox'], categories: ['keyboards'], categoryLimits: {},
    maxQuantity: 5, budgetCents: 30000, maxPurchaseCents: 5000, durationHours: 24,
  };
  const intents = [
    {
      id: 'hist-1', status: 'captured', createdAt: 1000, productId: 'hush-75',
      productName: 'Hush 75 Wireless', quantity: 2, totalCents: 9800,
      quote: catalog.find(p => p.id === 'hush-75'),
    },
    {
      id: 'hist-2', status: 'captured', createdAt: 2000, productId: 'desk-mouse',
      productName: 'Desk USB Mouse', quantity: 1, totalCents: 4900,
      quote: catalog.find(p => p.id === 'desk-mouse'),
    },
    {
      id: 'hist-canceled', status: 'canceled', createdAt: 3000, productId: 'hush-75',
      productName: 'Hush 75 Wireless', quantity: 5, totalCents: 24500,
      quote: catalog.find(p => p.id === 'hush-75'),
    },
  ];

  const report = simulatePolicy({
    candidateMandate: tighterCandidate,
    baselineMandate: baseline,
    intents,
    products: catalog,
    now,
  });

  assert.equal(report.dryRun, true);
  assert.ok(report.catalogSummary.riskReductionPct > 0);
  assert.equal(report.catalogSummary.allowedSkus, 2); // hush-75 ($49) and everyday-keys ($35); type-pro ($69) blocked by $50 cap
  assert.equal(report.historicalSummary.totalEvaluated, 2);
  assert.equal(report.historicalSummary.blockedCount, 2);
  assert.equal(report.historicalSummary.blockedSavingsCents, 14700);
});

test('service.simulateMandate executes strict dry-run with zero database mutations', t => {
  const store = createStore(':memory:');
  t.after(() => store.close());
  const service = createService(store, { merchantId: () => 'buywise-sandbox' }, async () => ({}), () => 1794000000000);
  service.saveMandate('alice', { name: 'Initial Rules', budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  const before = service.snapshot('alice');

  const sim = service.simulateMandate('alice', {
    name: 'Strict Lockdown',
    budgetCents: 15000,
    maxPurchaseCents: 5000,
    maxQuantity: 2,
    categories: ['keyboards'],
    merchantIds: [],
  });

  assert.equal(sim.dryRun, true);
  assert.equal(sim.catalogSummary.allowedSkus, 0);
  assert.equal(sim.catalogSummary.riskReductionPct, 100);

  const after = service.snapshot('alice');
  assert.equal(after.mandate.version, before.mandate.version);
  assert.equal(after.mandate.budgetCents, 30000);
  assert.equal(after.events.length, before.events.length);
  assert.equal(after.intents.length, before.intents.length);
});
