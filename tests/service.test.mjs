import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/server/store.mjs';
import { createService } from '../src/server/service.mjs';
import { inspectListing, attackListing, catalog } from '../src/core/catalog.mjs';
import { categoryIds } from '../src/core/categories.mjs';

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
  const ai = async () => ({ productId: 'hush-75', quantity: 5, explanation: 'Quiet switches suit a shared workspace and the total is within budget.' });
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
      return { productId: chosen.id, quantity: 1, explanation: chosen.description };
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
  const ai = async () => ({
    parsedRequest: { quantity: 5, budgetCents: 18000, currency: 'USD', category: 'keyboards' },
    productId: 'hush-75', quantity: 5, explanation: 'Example',
  });
  const service = createService(s.store, s.provider, ai, () => 1000);
  const result = await service.research('alice', 'Five keyboards under $180');
  assert.ok(result.decision.reasons.includes('REQUEST_BUDGET_EXCEEDED'));
  assert.throws(() => service.reserve('alice', { recommendationId: result.recommendationId }), /research again/);
  assert.equal(service.snapshot('alice').reservedCents, 0);
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
  const unsafe = createService(s.store, s.provider, async () => ({ productId: 'hush-75', quantity: 50, explanation: 'Unsafe model output' }), () => 1000);
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
