import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProcurementReceipt, renderPrintableReceiptHtml } from '../src/core/receipt.mjs';

test('refuses to generate a receipt for uncaptured purchases', () => {
  assert.throws(() => buildProcurementReceipt({ id: 'i1', status: 'reserved', captureId: null }));
  assert.throws(() => buildProcurementReceipt({ id: 'i2', status: 'order_created', captureId: null }));
  assert.throws(() => buildProcurementReceipt({ id: 'i3', status: 'captured', captureId: null }));
});

test('builds confirmed receipt from captured intent and verified webhook events', () => {
  const intent = {
    id: 'intent-1',
    productId: 'hush-75',
    productName: 'Hush 75 Wireless',
    quantity: 5,
    quote: { id: 'hush-75', category: 'keyboards', merchantId: 'buywise-sandbox', currency: 'USD', unitPriceCents: 4900, shippingCents: 0, taxCents: 0 },
    totalCents: 24500,
    mandateVersion: 3,
    mandateName: 'Q4 Hardware',
    mandateSha256: 'mandate-sha-123',
    decisionEvidenceSha256: 'evidence-sha-456',
    createdAt: 1794000000000,
    capturedAt: 1794000050000,
    status: 'captured',
    orderId: 'PAYPAL-ORDER-1',
    captureId: 'PAYPAL-CAP-1',
    webhookVerified: true,
    webhookEventId: 'WH-EVT-999',
    webhookEventType: 'PAYMENT.CAPTURE.COMPLETED',
    webhookVerifiedAt: 1794000090000,
  };
  const events = [
    {
      id: 'ev-policy',
      intentId: 'intent-1',
      kind: 'policy',
      title: 'Capture policy check',
      evidenceSha256: 'capture-evidence-sha-789',
      evidenceVerified: true,
      evidence: { mandate: { version: 3, name: 'Q4 Hardware' }, mandateSha256: 'mandate-sha-123' },
      createdAt: 1794000040000,
    },
  ];

  const receipt = buildProcurementReceipt(intent, events);
  assert.equal(receipt.status, 'CAPTURE_AND_WEBHOOK_VERIFIED');
  assert.equal(receipt.environment, 'PayPal Sandbox');
  assert.equal(receipt.paypal.orderId, 'PAYPAL-ORDER-1');
  assert.equal(receipt.paypal.captureId, 'PAYPAL-CAP-1');
  assert.equal(receipt.paypal.capturedAt, new Date(1794000050000).toISOString());
  assert.match(receipt.paypal.capturedAtDisplay, /^[A-Z][a-z]{2} \d{2}, \d{4} · \d{2}:\d{2}:\d{2} UTC$/);
  assert.equal(receipt.webhook.verified, true);
  assert.equal(receipt.webhook.eventId, 'WH-EVT-999');
  assert.equal(receipt.webhook.verifiedAt, new Date(1794000090000).toISOString());
  assert.match(receipt.webhook.verifiedAtDisplay, /^[A-Z][a-z]{2} \d{2}, \d{4} · \d{2}:\d{2}:\d{2} UTC$/);
  assert.equal(receipt.mandate.version, 3);
  assert.equal(receipt.mandate.versionLabel, 'v3');
  assert.equal(receipt.decisionEvidence.sha256, 'capture-evidence-sha-789');
  assert.equal(receipt.decisionEvidence.integrityVerified, true);
  assert.equal(receipt.items.length, 1);
  assert.equal(receipt.items[0].lineTotalCents, 24500);

  const html = renderPrintableReceiptHtml(receipt);
  assert.match(html, /buywise<span class="brand-dot">\.<\/span>/);
  assert.match(html, /PAYPAL-ORDER-1/);
  assert.match(html, /PAYPAL-CAP-1/);
  assert.match(html, /WH-EVT-999/);
  assert.match(html, /capture-evidence-sha-789/);
  assert.match(html, /v3/);
  assert.match(html, /This is system generated document and doesn&apos;t require any signature/);
  assert.doesNotMatch(html, /No real money moved/);
});

test('supports mixed basket breakdown and escapes untrusted HTML characters', () => {
  const intent = {
    id: 'intent-basket',
    productName: '5 × Hush 75 Wireless + 3 × Desk USB Mouse',
    quantity: 8,
    lines: [
      { product: { id: 'hush-75', name: 'Hush 75 Wireless', category: 'keyboards', merchantId: 'buywise-sandbox', currency: 'USD', unitPriceCents: 4900, shippingCents: 0, taxCents: 0 }, quantity: 5 },
      { product: { id: 'desk-mouse', name: 'Desk USB Mouse', category: 'mice', merchantId: 'buywise-sandbox', currency: 'USD', unitPriceCents: 1400, shippingCents: 0, taxCents: 0 }, quantity: 3 },
    ],
    totalCents: 28700,
    mandateVersion: 4,
    mandateName: '<script>alert(1)</script>',
    decisionEvidenceSha256: 'basket-sha-001',
    createdAt: 1794000000000,
    capturedAt: 1794000020000,
    status: 'captured',
    orderId: 'ORD-BASKET',
    captureId: 'CAP-BASKET',
    webhookVerified: false,
  };
  const receipt = buildProcurementReceipt(intent, []);
  assert.equal(receipt.status, 'CAPTURE_CONFIRMED_WEBHOOK_PENDING');
  assert.equal(receipt.items.length, 2);
  assert.equal(receipt.items[0].lineTotalCents, 24500);
  assert.equal(receipt.items[1].lineTotalCents, 4200);

  const html = renderPrintableReceiptHtml(receipt);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /\$287\.00/);
});
