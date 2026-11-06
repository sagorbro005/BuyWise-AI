import { readFile, writeFile } from 'node:fs/promises';

// Run with node --env-file=.env.local. Never print credentials or access tokens.
const base = 'https://api-m.sandbox.paypal.com';
const events = ['CHECKOUT.ORDER.APPROVED', 'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'].map(name => ({ name }));
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Configuration request failed (HTTP ${response.status}). Credentials were not logged.`);
  return response.json();
}
try {
  const { tunnels } = await json('http://127.0.0.1:4040/api/tunnels');
  const tunnel = tunnels.find(t => t.public_url?.startsWith('https://') && ['http://127.0.0.1:3000', 'http://localhost:3000'].includes(t.config?.addr));
  if (!tunnel) throw new Error('Start ngrok http http://127.0.0.1:3000 first.');
  const origin = new URL(tunnel.public_url).origin;
  const health = await json(`${origin}/api/health`);
  if (!health.ok || health.environment !== 'sandbox') throw new Error('Public tunnel did not reach BuyWise sandbox.');
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error('PayPal sandbox app credentials are missing.');
  const { access_token: token } = await json(`${base}/v1/oauth2/token`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials',
  });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const url = `${origin}/api/paypal/webhooks`;
  const { webhooks } = await json(`${base}/v1/notifications/webhooks`, { headers });
  let webhook = webhooks.find(w => w.url === url) || webhooks.find(w => w.id === process.env.PAYPAL_WEBHOOK_ID);
  if (webhook) {
    webhook = await json(`${base}/v1/notifications/webhooks/${encodeURIComponent(webhook.id)}`, { method: 'PATCH', headers, body: JSON.stringify([{ op: 'replace', path: '/url', value: url }, { op: 'replace', path: '/event_types', value: events }]) });
  } else {
    webhook = await json(`${base}/v1/notifications/webhooks`, { method: 'POST', headers, body: JSON.stringify({ url, event_types: events }) });
  }
  const verified = await json(`${base}/v1/notifications/webhooks/${encodeURIComponent(webhook.id)}`, { headers });
  if (verified.url !== url || events.some(e => !verified.event_types.some(v => v.name === e.name))) throw new Error('PayPal webhook registration did not match the requested URL and events.');
  let content = await readFile('.env.local', 'utf8');
  for (const [name, value] of Object.entries({ APP_URL: origin, PAYPAL_WEBHOOK_ID: verified.id, ALLOW_LOCAL_DEMO: 'true' })) {
    const line = new RegExp(`^${name}=.*$`, 'm');
    content = line.test(content) ? content.replace(line, `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile('.env.local', content);
  console.log(`PayPal sandbox webhook registered and retrieved successfully.\nPublic app: ${origin}\nListener: ${url}\nSaved APP_URL and PAYPAL_WEBHOOK_ID locally. Restart BuyWise if configuration does not reload.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
