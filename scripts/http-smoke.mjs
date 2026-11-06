import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
let cookie = '';
let checks = 0;
async function call(path, body, origin = base, withSession = true) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(withSession && cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie') };
}
function check(value, message) { assert.ok(value, message); checks++; console.log(`PASS ${message}`); }
const initial = await call('bootstrap');
cookie = initial.cookie.split(';')[0];
check(initial.status === 200 && initial.cookie.includes('HttpOnly') && initial.cookie.includes('SameSite=lax'), 'bootstrap establishes protected session');
check((await call('mandates', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' }, 'https://attacker.invalid')).status === 403, 'foreign origin rejected');
check((await call('mandates', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' }, base, false)).status === 401, 'missing session rejected');
check((await call('mandates', { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' })).status === 200, 'mandate persisted');
check((await call('intents', { productId: 'hush-75', quantity: 5, priceCents: 1 })).status === 400, 'client price override rejected');
check((await call('intents', { productId: 'type-pro', quantity: 5 })).status === 409, 'over-budget purchase rejected');
const attack = await call('attack', {});
check(attack.status === 200 && !attack.data.decision.allowed && attack.data.paypalCalled === false, 'attack fixture blocked before PayPal');
const reserved = await call('intents', { productId: 'hush-75', quantity: 5 });
check(reserved.status === 200 && reserved.data.totalCents === 24500, 'server resolves exact purchase amount');
check((await call('bootstrap')).data.reservedCents === 24500, 'reservation visible over HTTP');
check((await call('intents/cancel', { intentId: reserved.data.id })).status === 200, 'unsubmitted intent can be canceled');
check((await call('bootstrap')).data.reservedCents === 0, 'cancellation releases reservation');
if (!initial.data.config.ai) check((await call('agent/propose', { query: 'Five quiet wireless keyboards' })).status === 503, 'missing AI key produces honest setup error');
check((await call('paypal/webhooks', { id: 'invalid', event_type: 'PAYMENT.CAPTURE.COMPLETED' })).status >= 400, 'unsigned webhook cannot succeed');
console.log(`\n${checks} HTTP checks passed. No payment calls were made by this script.`);
