import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test('buywise.postman_collection.json adheres to Postman v2.1.0 schema and covers all endpoints', async () => {
  const rootPath = resolve('buywise.postman_collection.json');
  const publicPath = resolve('public/buywise.postman_collection.json');

  const rootContent = await readFile(rootPath, 'utf8');
  const publicContent = await readFile(publicPath, 'utf8');

  assert.equal(rootContent.trim(), publicContent.trim(), 'Root and public collection files must be identical');

  const collection = JSON.parse(rootContent);

  assert.ok(collection.info, 'Collection must have info object');
  assert.equal(collection.info.schema, 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json');
  assert.match(collection.info.name, /BuyWise AI/);

  assert.ok(Array.isArray(collection.item), 'Collection items must be an array of folders');
  assert.equal(collection.item.length, 6, 'Must contain 6 organized endpoint folders');

  const folderNames = collection.item.map(f => f.name);
  assert.deepEqual(folderNames, [
    '01 - System & Session',
    '02 - Mandate Policy & What-If Simulator',
    '03 - AI Purchasing Assistant',
    '04 - Basket & Intent Checkout',
    '05 - PayPal Sandbox Operations',
    '06 - AgentGuard Defense Lab',
  ]);

  // Flatten all requests across folders
  const allRequests = collection.item.flatMap(f => f.item.map(i => ({
    folder: f.name,
    name: i.name,
    method: i.request.method,
    rawUrl: i.request.url.raw,
  })));

  assert.ok(allRequests.length >= 14, `Expected at least 14 configured requests, got ${allRequests.length}`);

  // Validate presence of critical routes
  const routes = allRequests.map(r => `${r.method} ${r.rawUrl}`);
  assert.ok(routes.some(r => r === 'GET {{baseUrl}}/api/health'));
  assert.ok(routes.some(r => r === 'GET {{baseUrl}}/api/bootstrap'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/mandates'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/mandates/simulate'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/mandates/revoke'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/agent/propose'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/intents'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/intents/cancel'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/paypal/create'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/paypal/capture'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/paypal/webhooks'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/attack'));
  assert.ok(routes.some(r => r === 'POST {{baseUrl}}/api/attack/webhook'));
});
