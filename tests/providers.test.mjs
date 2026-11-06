import test from 'node:test';
import assert from 'node:assert/strict';
import { paypalProvider } from '../src/server/providers.mjs';

function fakeTransport() {
  const calls = [];
  return { calls, send: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/token')) return Response.json({ access_token: 'test-token', expires_in: 300 });
    if (url.endsWith('verify-webhook-signature')) return Response.json({ verification_status: 'SUCCESS' });
    return Response.json({ id: 'ORDER-1', status: 'CREATED' });
  } };
}
const env = { PAYPAL_CLIENT_ID: 'test-client', PAYPAL_CLIENT_SECRET: 'test-secret', PAYPAL_MERCHANT_ID: 'seller-1', PAYPAL_WEBHOOK_ID: 'hook-1' };
test('PayPal adapter locks the sandbox host, merchant, cents and request ID', async () => {
  const fake = fakeTransport(); const provider = paypalProvider(env, fake.send);
  await provider.create({ id: 'intent-1', quantity: 5, productName: 'Keyboard', totalCents: 24500 });
  const request = fake.calls[1]; const body = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api-m.sandbox.paypal.com/v2/checkout/orders');
  assert.equal(request.options.headers['PayPal-Request-Id'], 'create-intent-1');
  assert.deepEqual(body.purchase_units[0].amount, { currency_code: 'USD', value: '245.00' });
  assert.equal(body.purchase_units[0].payee.merchant_id, 'seller-1');
  assert.equal(body.purchase_units[0].custom_id, 'intent-1');
});
test('PayPal token is reused and capture request ID stays stable', async () => {
  const fake = fakeTransport(); const provider = paypalProvider(env, fake.send);
  await provider.capture({ id: 'intent-1', orderId: 'ORDER-1' });
  await provider.capture({ id: 'intent-1', orderId: 'ORDER-1' });
  assert.equal(fake.calls.filter(c => c.url.endsWith('/token')).length, 1);
  assert.equal(fake.calls[2].options.headers['PayPal-Request-Id'], 'capture-intent-1');
});
test('webhook postback uses configured ID and signature headers', async () => {
  const fake = fakeTransport(); const provider = paypalProvider(env, fake.send);
  const headers = new Headers({ 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert', 'paypal-transmission-id': 't-1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-11-05T00:00:00Z' });
  await provider.verify(headers, { id: 'event-1' });
  const body = JSON.parse(fake.calls[1].options.body);
  assert.equal(body.webhook_id, 'hook-1');
  assert.equal(body.transmission_id, 't-1');
  assert.equal(body.webhook_event.id, 'event-1');
});
test('missing verification headers cannot call the provider', async () => {
  const fake = fakeTransport(); const provider = paypalProvider(env, fake.send);
  await assert.rejects(provider.verify(new Headers(), { id: 'event' }), /Missing/);
  assert.equal(fake.calls.length, 0);
});
test('invalid signature status fails closed', async () => {
  const provider = paypalProvider(env, async url => Response.json(url.endsWith('/token') ? { access_token: 'token', expires_in: 300 } : { verification_status: 'FAILURE' }));
  const headers = new Headers({ 'paypal-auth-algo': 'alg', 'paypal-cert-url': 'url', 'paypal-transmission-id': 'id', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': 'time' });
  await assert.rejects(provider.verify(headers, {}), /invalid/);
});
