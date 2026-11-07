import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/server/store.mjs';
import { createService } from '../src/server/service.mjs';
import { inspectListing, attackListing, catalog } from '../src/core/catalog.mjs';
import { categoryIds } from '../src/core/categories.mjs';

function ranking(products, preferredId, quantity = 5, request = {}) {
  return {
    parsedRequest: { productQuery: 'Office supplies', category: products[0].category, quantity, currency: 'USD', budgetCents: null, requirements: [], ...request },
    rankedOffers: [...products].sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId))
      .map(p => ({ productId: p.id, evidence: [] })),
  };
}

function setup(t) {
  const store = createStore(':memory:'); t.after(() => store.close());
  let now = 1000, creates = 0, captures = 0, verified = true, mismatch = false, timeout = false;
  const orders = new Map();
  const provider = {
    merchantId: () => 'merchant-1',
    async create(intent) {
      creates++;
      const id = `ORDER-${intent.id}`;
      if (!orders.has(id)) orders.set(id, { id, status: 'CREATED', intent: 'CAPTURE', purchase_units: [{ custom_id: intent.id, payee: { merchant_id: 'merchant-1' }, amount: { currency_code: 'USD', value: (intent.totalCents / 100).toFixed(2) } }] });
      if (intent.lines) orders.get(id).purchase_units[0].items = intent.lines.map(({ product, quantity }) => ({
        sku: product.id, quantity: String(quantity), unit_amount: { currency_code: 'USD', value: (product.unitPriceCents / 100).toFixed(2) },
      }));
      return structuredClone(orders.get(id));
    },
    async get(id) {
      const order = structuredClone(orders.get(id));
      if (mismatch) order.purchase_units[0].amount.value = '0.01';
      return order;
    },
    async capture(intent) {
      captures++;
      const order = orders.get(intent.orderId); order.status = 'COMPLETED';
      order.purchase_units[0].payments = { captures: [{ id: 'CAPTURE-1', status: 'COMPLETED', amount: structuredClone(order.purchase_units[0].amount) }] };
      if (timeout) throw new Error('Network timeout after capture');
      return structuredClone(order);
    },
    async verify() { if (!verified) throw new Error('Invalid signature'); },
  };
  const ai = async ({ products }) => ranking(products, 'hush-75');
  const service = createService(store, provider, ai, () => now);
  service.saveMandate('alice', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  return { store, service, provider, orders,
    reserve: () => service.reserve('alice', { productId: 'hush-75', quantity: 5 }),
    approve(id) { orders.get(id).status = 'APPROVED'; },
    counts: () => ({ creates, captures }),
    invalidSignature: () => { verified = false; }, mismatch: () => { mismatch = true; },
    timeout: () => { timeout = true; }, advance: ms => { now += ms; },
    webhook: orderId => ({ id: 'EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAPTURE-1', amount: { currency_code: 'USD', value: '245.00' }, supplementary_data: { related_ids: { order_id: orderId } } } }),
  };
}

test('each mandate category offers distinct, priced alternatives and enforces the saved seller list', async t => {
  const s = setup(t);
  assert.equal(new Set(catalog.map(p => p.id)).size, catalog.length);
  for (const category of categoryIds) {
    const options = catalog.filter(p => p.category === category);
    assert.ok(new Set(options.map(p => p.unitPriceCents)).size >= 3);
    const chosen = options[1];
    const service = createService(s.store, s.provider, async ({ products }) => {
      assert.deepEqual(new Set(products.map(p => p.id)), new Set(options.map(p => p.id)));
      return ranking(products, chosen.id, 1);
    }, () => 1000);
    const fields = { category, budgetCents: 30000, maxQuantity: 5 };
    service.saveMandate('alice', { ...fields, merchantIds: [] });
    const denied = await service.research('alice', 'Compare options for my desk');
    assert.ok(denied.decision.reasons.includes('MERCHANT_NOT_ALLOWED'));
    assert.throws(() => service.reserve('alice', { productId: chosen.id, quantity: 1 }), /MERCHANT_NOT_ALLOWED/);
    service.saveMandate('alice', fields);
    const match = await service.research('alice', 'Compare options for my desk');
    const intent = service.reserve('alice', { recommendationId: match.recommendationId });
    assert.equal(intent.totalCents, chosen.unitPriceCents);
    service.cancel('alice', intent.id);
  }
  assert.deepEqual(s.counts(), { creates: 0, captures: 0 });
});

test('cap, seller selection, expiration and revocation enforce the configured permissions', t => {
  const s = setup(t);
  const fields = { name: 'Office', budgetCents: 30000, maxPurchaseCents: 20000, maxQuantity: 5, category: 'keyboards', durationHours: 2 };
  const m = s.service.saveMandate('alice', fields);
  assert.equal(m.expiresAt, 1000 + 7200000);
  assert.throws(s.reserve, /PURCHASE_LIMIT_EXCEEDED/);
  s.service.saveMandate('alice', { ...fields, maxPurchaseCents: 30000, merchantIds: [] });
  assert.throws(s.reserve, /MERCHANT_NOT_ALLOWED/);
  s.service.revoke('alice');
  assert.throws(s.reserve, /MANDATE_INACTIVE/);
  assert.equal(s.store.get('mandate-version','alice/2').maxPurchaseCents, 20000);
});

test('unused quote expiry releases reserved funds', t => {
  const s = setup(t);
  s.reserve();
  s.advance(16 * 60000);
  const state = s.service.snapshot('alice');
  assert.equal(state.reservedCents, 0);
  assert.equal(state.intents[0].status, 'expired');
});

test('replaying a research proposal returns its original purchase even after cancellation', async t => {
  const s = setup(t);
  const { recommendationId } = await s.service.research('alice', 'Five quiet keyboards');
  const i = s.service.reserve('alice', { recommendationId });
  s.service.cancel('alice', i.id);
  const replay = s.service.reserve('alice', { recommendationId });
  assert.equal(replay.id, i.id);
  assert.equal(replay.status, 'canceled');
  assert.equal(s.service.snapshot('alice').reservedCents, 0);
});

test('approved order webhook records approval once without spending any budget', async t => {
  const s = setup(t);
  const i = s.reserve();
  const o = await s.service.createOrder('alice', i.id);
  s.approve(o.orderId);
  const e = { id: 'approval-event', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: o.orderId } };
  await s.service.webhook(new Headers(), e);
  assert.equal((await s.service.webhook(new Headers(), e)).duplicate, true);
  assert.equal(s.service.snapshot('alice').spentCents, 0);
  assert.equal(s.counts().captures, 0);
});

test('a proposal that fits the mandate still fails the shopper’s narrower request', async t => {
  const s = setup(t);
  const ai = async ({ products }) => ranking(products, 'hush-75', 5, { budgetCents: 10000 });
  const service = createService(s.store, s.provider, ai, () => 1000);
  const result = await service.research('alice', 'Five keyboards under $100');
  assert.equal(result.outcome, 'no_match');
  assert.equal(result.recommendationId, null);
  assert.equal(result.proposal, null);
  assert.ok(result.rows.every(row => row.requestReasons.includes('REQUEST_BUDGET_EXCEEDED')));
  assert.equal(service.snapshot('alice').reservedCents, 0);
});

test('webcam comparison checks listing quotes, totals and mandate independently', async t => {
  const s = setup(t);
  s.service.saveMandate('alice', { category: 'webcams', budgetCents: 10000, maxQuantity: 2 });
  let budgetCents = 10000;
  const ai = async ({ products }) => {
    const result = ranking(products, 'clip-720', 2, { requirements: ['1080p', 'physical privacy shutter'], budgetCents });
    for (const offer of result.rankedOffers) {
      // Clip has neither feature. Room Wide has no shutter in its listing.
      offer.evidence = ['1080p', 'physical privacy shutter'];
    }
    return result;
  };
  const svc = createService(s.store, s.provider, ai, () => 1000);
  const found = await svc.research('alice', 'Two 1080p webcams with a shutter');
  assert.equal(found.proposal.productId, 'shutter-hd');
  assert.equal(found.rows.find(r => r.productId === 'clip-720').featureFit, false);
  assert.deepEqual(found.rows.find(r => r.productId === 'clip-720').policyReasons, []);
  assert.ok(found.rows.find(r => r.productId === 'room-wide').policyReasons.includes('BUDGET_EXCEEDED'));
  assert.equal(svc.reserve('alice', { recommendationId: found.recommendationId }).totalCents, 7800);
  svc.cancel('alice', svc.snapshot('alice').intents[0].id);
  budgetCents = 6000;
  const none = await svc.research('alice', 'Two webcams under $60');
  assert.equal(none.outcome, 'no_match');
  assert.match(none.message, /\$78\.00.*\$18\.00 above/);
  assert.equal(none.recommendationId, null);
  assert.equal(svc.snapshot('alice').reservedCents, 0);
  assert.deepEqual(s.counts(), { creates: 0, captures: 0 });
});

test('unsupported request category produces no recommendation; incomplete model rankings fail closed', async t => {
  const s = setup(t);
  const svc = createService(s.store, s.provider, async ({ products }) =>
    ranking(products, 'hush-75', 1, { category: 'other' }), () => 1000);
  assert.equal((await svc.research('alice', 'A laptop')).outcome, 'no_match');
  const invalid = createService(s.store, s.provider, async ({ products }) => {
    const answer = ranking(products, 'hush-75');
    answer.rankedOffers.pop();
    return answer;
  }, () => 1000);
  await assert.rejects(invalid.research('alice', 'Compare keyboards'), /every listing/);
});

test('rejected and accepted decisions retain their original rules and expose snapshot changes', t => {
  const s = setup(t);
  assert.throws(() => s.service.reserve('alice', { productId: 'type-pro', quantity: 5 }), /BUDGET_EXCEEDED/);
  const intent = s.reserve();
  s.service.cancel('alice', intent.id);
  s.service.saveMandate('alice', { budgetCents: 50000, maxQuantity: 8, category: 'mice' });
  const events = s.service.snapshot('alice').events;
  const denied = events.find(e => e.title === 'Purchase blocked');
  const allowed = events.find(e => e.title === 'Purchase cleared by AgentGuard');
  for (const record of [denied, allowed]) {
    assert.equal(record.evidenceVerified, true);
    assert.equal(record.evidence.mandate.version, 1);
    assert.equal(record.evidence.mandate.budgetCents, 30000);
    assert.equal(record.evidence.mandate.owner, undefined);
    assert.equal(record.evidence.mandate.id, undefined);
    assert.match(record.evidence.mandateSha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(denied.evidence.decision.allowed, false);
  assert.equal(denied.evidence.product.unitPriceCents, 6900);
  assert.equal(allowed.evidence.decision.totalCents, 24500);
  const stored = s.store.get('event', denied.id);
  stored.evidence.product.unitPriceCents = 1;
  s.store.put('event', stored);
  assert.equal(s.service.snapshot('alice').events.find(e => e.id === denied.id).evidenceVerified, false);
});

test('attack fixture rejected without any payment calls or reservation', t => {
  const s = setup(t); const result = s.service.attack('alice');
  assert.equal(result.decision.allowed, false);
  assert.ok(result.decision.reasons.includes('MERCHANT_NOT_ALLOWED'));
  assert.ok(result.decision.reasons.includes('BUDGET_EXCEEDED'));
  assert.equal(s.service.snapshot('alice').reservedCents, 0);
  assert.deepEqual(s.counts(), { creates: 0, captures: 0 });
  assert.ok(inspectListing(attackListing.description).length >= 3);
});
test('rejects client-supplied amounts instead of trusting them', t => {
  const s = setup(t);
  assert.throws(() => s.service.reserve('alice', { productId: 'hush-75', quantity: 5, totalCents: 1 }));
});
test('duplicate reservation does not overspend', t => {
  const s = setup(t); s.reserve(); assert.throws(s.reserve);
  assert.equal(s.service.snapshot('alice').reservedCents, 24500);
});
test('cannot change mandate while money is reserved', t => {
  const s = setup(t); s.reserve();
  assert.throws(() => s.service.saveMandate('alice', { budgetCents: 50000, maxQuantity: 5, category: 'keyboards' }));
});
test('cross-session order access rejected', async t => {
  const s = setup(t); const intent = s.reserve();
  await assert.rejects(s.service.createOrder('bob', intent.id), /not found/);
  assert.deepEqual(s.counts(), { creates: 0, captures: 0 });
});
test('repeated create and capture are idempotent', async t => {
  const s = setup(t); const intent = s.reserve();
  const order = await s.service.createOrder('alice', intent.id);
  assert.equal((await s.service.createOrder('alice', intent.id)).orderId, order.orderId);
  s.approve(order.orderId);
  assert.equal((await s.service.capture('alice', intent.id)).status, 'captured');
  assert.equal((await s.service.capture('alice', intent.id)).status, 'captured');
  assert.deepEqual(s.counts(), { creates: 1, captures: 1 });
  assert.equal(s.service.snapshot('alice').spentCents, 24500);
  assert.equal(s.service.snapshot('alice').reservedCents, 0);
});
test('parallel create admits only one provider request', async t => {
  const s = setup(t); const intent = s.reserve();
  const results = await Promise.allSettled([s.service.createOrder('alice', intent.id), s.service.createOrder('alice', intent.id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(s.counts().creates, 1);
});
test('capture requires PayPal approval', async t => {
  const s = setup(t); const intent = s.reserve(); await s.service.createOrder('alice', intent.id);
  await assert.rejects(s.service.capture('alice', intent.id), /Approve/);
  assert.equal(s.counts().captures, 0);
});
test('expired quote cannot capture', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); s.advance(16 * 60000);
  await assert.rejects(s.service.capture('alice', intent.id), /expired/);
  assert.equal(s.counts().captures, 0);
});
test('tampered PayPal amount cannot capture', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); s.mismatch();
  await assert.rejects(s.service.capture('alice', intent.id), /mismatch/);
  assert.equal(s.counts().captures, 0);
});
test('capture timeout retains budget until provider reconciliation', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); s.timeout();
  await assert.rejects(s.service.capture('alice', intent.id));
  assert.equal(s.service.snapshot('alice').reservedCents, 24500);
  assert.throws(() => s.service.cancel('alice', intent.id), /uncertain/);
  assert.equal((await s.service.reconcile('alice', intent.id)).status, 'captured');
  assert.equal(s.service.snapshot('alice').reservedCents, 0);
  assert.equal(s.service.snapshot('alice').spentCents, 24500);
});
test('cancel revokes permission to capture an already approved order', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId);
  s.service.cancel('alice', intent.id);
  await assert.rejects(s.service.capture('alice', intent.id), /not available/);
  assert.equal(s.counts().captures, 0);
});
test('verified duplicate webhook counts the payment and audit confirmation once', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); await s.service.capture('alice', intent.id);
  await s.service.webhook(new Headers(), s.webhook(order.orderId));
  const duplicate = await s.service.webhook(new Headers(), s.webhook(order.orderId));
  assert.equal(duplicate.duplicate, true);
  const snapshot = s.service.snapshot('alice');
  assert.equal(snapshot.spentCents, 24500);
  assert.equal(snapshot.intents[0].webhookVerified, true);
  assert.equal(snapshot.events.filter(e => e.kind === 'verified').length, 1);
});
test('invalid signature never updates payment state', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.invalidSignature();
  await assert.rejects(s.service.webhook(new Headers(), s.webhook(order.orderId)), /signature/);
  assert.equal(s.service.snapshot('alice').intents[0].webhookVerified, false);
});
test('mismatched webhook capture is rejected', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); await s.service.capture('alice', intent.id);
  const event = s.webhook(order.orderId); event.resource.id = 'WRONG-CAPTURE';
  await assert.rejects(s.service.webhook(new Headers(), event), /does not match/);
  assert.equal(s.service.snapshot('alice').intents[0].webhookVerified, false);
});
test('AI recommendation is independently checked', async t => {
  const s = setup(t); const result = await s.service.research('alice', 'Five quiet keyboards');
  assert.equal(result.source, 'gemini'); assert.equal(result.decision.allowed, true);
  const unsafe = createService(s.store, s.provider, async ({ products }) => ranking(products, 'hush-75', 50), () => 1000);
  assert.equal((await unsafe.research('alice', 'Five quiet keyboards')).decision.allowed, false);
  assert.equal(s.counts().creates, 0);
});
test('revocation cancels an unused reservation and reactivation does not revive it', async t => {
  const s = setup(t); const i = s.reserve();
  s.service.revoke('alice');
  assert.equal(s.service.snapshot('alice').reservedCents, 0);
  assert.throws(s.reserve, /MANDATE_INACTIVE/);
  await assert.rejects(s.service.createOrder('alice', i.id));
  s.service.saveMandate('alice', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  await assert.rejects(s.service.createOrder('alice', i.id));
  assert.equal(s.counts().creates, 0);
  assert.notEqual(s.reserve().id, i.id);
});

test('revoked approved order cannot reopen checkout or capture', async t => {
  const s = setup(t); const i = s.reserve();
  const order = await s.service.createOrder('alice', i.id); s.approve(order.orderId);
  s.service.revoke('alice');
  await assert.rejects(s.service.createOrder('alice', i.id), /reopen/);
  await assert.rejects(s.service.capture('alice', i.id), /not available/);
  assert.equal(s.counts().captures, 0);
});

test('existing order rechecks expiry and mandate version before reopening checkout', async t => {
  const s = setup(t); const i = s.reserve(); await s.service.createOrder('alice', i.id);
  const rules = s.store.get('mandate', 'alice');
  s.store.put('mandate', { ...rules, version: rules.version + 1 });
  await assert.rejects(s.service.createOrder('alice', i.id), /mandate_changed/);
  s.store.put('mandate', rules); s.advance(16 * 60000);
  await assert.rejects(s.service.createOrder('alice', i.id), /quote_expired/);
  assert.equal(s.counts().creates, 1);
});

test('revocation during order creation preserves uncertainty then prevents capture', async t => {
  const s = setup(t); const i = s.reserve();
  const create = s.provider.create;
  s.provider.create = async intent => {
    s.service.revoke('alice');
    assert.equal(s.service.snapshot('alice').reservedCents, 24500);
    return create(intent);
  };
  const order = await s.service.createOrder('alice', i.id); s.approve(order.orderId);
  await assert.rejects(s.service.capture('alice', i.id), /mandate_inactive/);
  assert.equal(s.counts().captures, 0);
});

test('revocation while fetching approval stops the subsequent capture request', async t => {
  const s = setup(t); const i = s.reserve();
  const order = await s.service.createOrder('alice', i.id); s.approve(order.orderId);
  const get = s.provider.get;
  s.provider.get = async id => { s.service.revoke('alice'); return get(id); };
  await assert.rejects(s.service.capture('alice', i.id));
  assert.equal(s.counts().captures, 0);
});

test('revocation cannot undo dispatched capture and preserves its eventual accounting', async t => {
  const s = setup(t); const i = s.reserve();
  const order = await s.service.createOrder('alice', i.id); s.approve(order.orderId);
  const capture = s.provider.capture;
  s.provider.capture = async intent => {
    s.service.revoke('alice');
    assert.equal(s.service.snapshot('alice').reservedCents, 24500);
    return capture(intent);
  };
  await s.service.capture('alice', i.id);
  assert.equal(s.service.snapshot('alice').spentCents, 24500);
  assert.equal(s.service.snapshot('alice').mandate.active, false);
});

test('completed spending remains counted after a new mandate', async t => {
  const s = setup(t); const intent = s.reserve(); const order = await s.service.createOrder('alice', intent.id); s.approve(order.orderId); await s.service.capture('alice', intent.id);
  s.service.saveMandate('alice', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  assert.throws(s.reserve, /BUDGET_EXCEEDED/);
});

const mixedRules = { categories: ['keyboards', 'mice'], categoryLimits: { keyboards: 5, mice: 3 },
  maxQuantity: 8, budgetCents: 30000, maxPurchaseCents: 30000 };
const exampleBasket = { lines: [{ productId: 'hush-75', quantity: 5 }, { productId: 'desk-mouse', quantity: 3 }] };

test('mixed basket reserves once and completes one order, capture and verified event', async t => {
  const s = setup(t);
  s.service.saveMandate('alice', mixedRules);
  const intent = s.service.reserve('alice', exampleBasket);
  assert.equal(intent.totalCents, 28700);
  assert.equal(intent.quantity, 8);
  assert.equal(s.service.snapshot('alice').reservedCents, 28700);
  assert.throws(() => s.service.reserve('alice', exampleBasket), /blocked|open purchase/i);
  const order = await s.service.createOrder('alice', intent.id);
  s.approve(order.orderId);
  await s.service.capture('alice', intent.id);
  const event = s.webhook(order.orderId);
  event.resource.amount.value = '287.00';
  await s.service.webhook(new Headers(), event);
  await s.service.webhook(new Headers(), event);
  const state = s.service.snapshot('alice');
  assert.equal(state.spentCents, 28700);
  assert.equal(state.reservedCents, 0);
  assert.equal(state.intents[0].webhookVerified, true);
  assert.deepEqual(s.counts(), { creates: 1, captures: 1 });
});

test('basket rejects combined cap, counts across repeated SKUs, unauthorized lines and stale checkout', async t => {
  const s = setup(t);
  for (const [rules, expected] of [
    [{ ...mixedRules, maxPurchaseCents: 25000 }, /PURCHASE_LIMIT_EXCEEDED/],
    [{ ...mixedRules, maxQuantity: 7 }, /QUANTITY_NOT_ALLOWED/],
    [{ ...mixedRules, categories: ['keyboards'], categoryLimits: {} }, /CATEGORY_NOT_ALLOWED/],
    [{ ...mixedRules, merchantIds: [] }, /MERCHANT_NOT_ALLOWED/],
  ]) {
    s.service.saveMandate('alice', rules);
    assert.throws(() => s.service.reserve('alice', exampleBasket), expected);
    assert.equal(s.service.snapshot('alice').reservedCents, 0);
  }
  s.service.saveMandate('alice', mixedRules);
  assert.throws(() => s.service.reserve('alice', { lines: [exampleBasket.lines[0], { productId: 'everyday-keys', quantity: 1 }] }), /CATEGORY_QUANTITY_EXCEEDED/);
  assert.throws(() => s.service.reserve('alice', { lines: [{ ...exampleBasket.lines[0], price: 1 }] }));
  const i = s.service.reserve('alice', exampleBasket);
  s.service.revoke('alice');
  await assert.rejects(s.service.createOrder('alice', i.id));
  assert.deepEqual(s.counts(), { creates: 0, captures: 0 });
});

test('AI chooses a feasible combination and never reserves a partial result', async t => {
  const s = setup(t);
  let budget = 30000;
  let missing = false;
  const ai = async ({ products }) => ({
    lines: ['keyboards', 'mice'].map((category, index) => {
      const list = products.filter(p => p.category === category);
      const answer = ranking(list, index ? 'glide-mouse' : 'hush-75', index ? 3 : 5);
      if (missing && index) { answer.parsedRequest.requirements = ['unlisted feature']; answer.rankedOffers.forEach(o => { o.evidence = [null]; }); }
      return answer;
    }), basketBudgetCents: budget, basketCurrency: 'USD',
  });
  const svc = createService(s.store, s.provider, ai, () => 1000);
  svc.saveMandate('alice', mixedRules);
  const found = await svc.research('alice', 'Five keyboards and three mice');
  assert.equal(found.outcome, 'match');
  assert.equal(found.entries.length, 2);
  assert.ok(found.decision.totalCents <= budget);
  const i = svc.reserve('alice', { recommendationId: found.recommendationId });
  assert.equal(svc.reserve('alice', { recommendationId: found.recommendationId }).id, i.id);
  svc.cancel('alice', i.id);
  budget = 20000;
  const denied = await svc.research('alice', 'Both categories under two hundred dollars');
  assert.equal(denied.outcome, 'blocked');
  assert.equal(denied.recommendationId, null);
  missing = true;
  const none = await svc.research('alice', 'Also require unlisted feature on mice');
  assert.equal(none.outcome, 'no_match');
  assert.deepEqual(none.entries, []);
  assert.equal(svc.snapshot('alice').reservedCents, 0);
});

test('a counted product cannot be substituted to fit a lower basket cap', async t => {
  const s = setup(t);
  const ai = async ({products}) => ({
    lines: ['keyboards', 'mice'].map((cat, idx) => ranking(products.filter(p => p.category === cat), idx ? 'desk-mouse' : 'everyday-keys', idx ? 3 : 5)),
    basketBudgetCents: 30000, basketCurrency: 'USD',
  });
  const svc = createService(s.store, s.provider, ai, () => 1000);
  svc.saveMandate('alice', { ...mixedRules, maxPurchaseCents: 25000 });
  const result = await svc.research('alice', '5 Hush 75 Wireless keyboards and 3 Desk USB Mouse');
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.decision.totalCents, 28700);
  assert.match(result.message, /37.00/);
  await assert.rejects(svc.research('alice', '5 keyboards and 4 mice'), /every requested item/);
});

test('same-total PayPal basket with substituted or missing items cannot capture', async t => {
  const s = setup(t);
  s.service.saveMandate('alice', mixedRules);
  const i = s.service.reserve('alice', exampleBasket);
  const order = await s.service.createOrder('alice', i.id);
  s.approve(order.orderId);
  const unit = s.orders.get(order.orderId).purchase_units[0];
  unit.items[0].sku = 'another-keyboard';
  await assert.rejects(s.service.capture('alice', i.id), /basket items/);
  delete unit.items;
  await assert.rejects(s.service.capture('alice', i.id), /details are missing/);
  assert.equal(s.counts().captures, 0);
});

test('duplicate basket lines cannot bypass combined stock and stale basket amounts cannot capture', async t => {
  const s = setup(t);
  s.service.saveMandate('alice', { categories: ['keyboards', 'mice'], maxQuantity: 50, budgetCents: 100000 });
  assert.throws(() => s.service.reserve('alice', {lines:[{productId:'rise-mouse',quantity:8},{productId:'rise-mouse',quantity:8}]}), /INSUFFICIENT_STOCK/);
  const i = s.service.reserve('alice', exampleBasket);
  const order = await s.service.createOrder('alice', i.id);
  s.approve(order.orderId);
  s.advance(16 * 60000);
  await assert.rejects(s.service.capture('alice', i.id), /expired/);
  assert.equal(s.counts().captures, 0);
});
