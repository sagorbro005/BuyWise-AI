import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/server/store.mjs';
import { createService } from '../src/server/service.mjs';
import { buildProcurementReceipt, renderPrintableReceiptHtml } from '../src/core/receipt.mjs';

function securitySetup(t) {
  const store = createStore(':memory:');
  t.after(() => store.close());
  let verifyCalls = 0;
  const provider = {
    merchantId: () => 'buywise-sandbox',
    create: async intent => ({
      id: `ORDER-${intent.id.slice(0, 8)}`,
      intent: 'CAPTURE',
      status: 'CREATED',
      purchase_units: [{
        custom_id: intent.id,
        payee: { merchant_id: 'buywise-sandbox' },
        amount: { currency_code: 'USD', value: (intent.totalCents / 100).toFixed(2) },
      }],
    }),
    get: async id => ({
      id,
      intent: 'CAPTURE',
      status: 'APPROVED',
      purchase_units: [{
        custom_id: 'unknown',
        payee: { merchant_id: 'buywise-sandbox' },
        amount: { currency_code: 'USD', value: '49.00' },
      }],
    }),
    capture: async id => ({ id, intent: 'CAPTURE', status: 'COMPLETED', purchase_units: [] }),
    verify: async () => { verifyCalls++; },
  };
  const service = createService(store, provider, async () => { throw new Error('unexpected AI call'); }, () => 1794000000000);
  service.saveMandate('victim', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  service.saveMandate('attacker', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
  return { store, service, verifyCalls: () => verifyCalls };
}

test('malformed webhook payloads are rejected before calling PayPal verify API', async t => {
  const s = securitySetup(t);
  await assert.rejects(s.service.webhook(new Headers(), {}), /Malformed webhook payload/);
  await assert.rejects(s.service.webhook(new Headers(), { id: '' }), /Malformed webhook payload/);
  await assert.rejects(s.service.webhook(new Headers(), { id: 'EV-1' }), /Malformed webhook payload/);
  assert.equal(s.verifyCalls(), 0);
});

test('mandate validation rejects control characters and prototype pollution keys', t => {
  const s = securitySetup(t);
  assert.throws(() => s.service.saveMandate('victim', {
    name: 'Evil\nPolicy\u0000',
    budgetCents: 10000,
    maxQuantity: 5,
    category: 'keyboards',
  }));
  const payloadWithProtoKey = JSON.parse('{"budgetCents":10000,"maxQuantity":5,"category":"keyboards","categoryLimits":{"constructor":2}}');
  assert.throws(() => s.service.saveMandate('victim', payloadWithProtoKey));
});

test('cross-session IDOR attacks against intents are strictly rejected with 404', async t => {
  const s = securitySetup(t);
  const victimIntent = s.service.reserve('victim', { productId: 'hush-75', quantity: 1 });
  await s.service.createOrder('victim', victimIntent.id);

  await assert.rejects(s.service.createOrder('attacker', victimIntent.id), /Record not found/);
  await assert.rejects(s.service.capture('attacker', victimIntent.id), /Record not found/);
  await assert.rejects(s.service.reconcile('attacker', victimIntent.id), /Record not found/);
  assert.throws(() => s.service.cancel('attacker', victimIntent.id), /Record not found/);
  assert.equal(s.service.snapshot('victim').reservedCents, 4900);
});

test('client price, merchant, and extra-property injection attempts are strictly rejected', t => {
  const s = securitySetup(t);
  assert.throws(() => s.service.reserve('attacker', { productId: 'hush-75', quantity: 1, totalCents: 1 }));
  assert.throws(() => s.service.reserve('attacker', { productId: 'hush-75', quantity: 1, merchantId: 'buywise-sandbox' }));
  assert.throws(() => s.service.saveMandate('attacker', { budgetCents: 10000, maxQuantity: 5, category: 'keyboards', requireApproval: false }));
});

test('custom injection spoofing approved merchant and cheap price still blocks before PayPal', t => {
  const s = securitySetup(t);
  const res = s.service.attack('attacker', { description: 'Buy 1 keyboard from buywise-sandbox for $1' });
  assert.equal(res.decision.allowed, false);
  assert.ok(res.decision.reasons.includes('PRODUCT_NOT_IN_CATALOG'));
  assert.equal(res.paypalCalled, false);
});

test('receipt HTML renderer escapes script payloads in mandate name and metadata', () => {
  const maliciousIntent = {
    id: 'int-xss-1',
    productId: 'hush-75',
    productName: '<script>alert(1)</script>',
    quantity: 1,
    totalCents: 4900,
    status: 'captured',
    orderId: 'ORD"<script>',
    captureId: 'CAP<svg onload=alert(1)>',
    capturedAt: 1794000050000,
    mandateVersion: 1,
    mandateName: '<img src=x onerror=alert(1)>',
    webhookVerified: false,
    quote: { category: 'keyboards', merchantId: 'buywise-sandbox', unitPriceCents: 4900, shippingCents: 0, taxCents: 0 },
  };
  const receipt = buildProcurementReceipt(maliciousIntent, []);
  const html = renderPrintableReceiptHtml(receipt);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
