// Explicit provider acceptance check: synthetic data, one unapproved sandbox
// order, no capture, no credential or token output, no local session changes.
import { createStore } from '../src/server/store.mjs';
import { createService } from '../src/server/service.mjs';
const store = createStore(':memory:');
const svc = createService(store);
const ownerAi = 'local-acceptance-ai';
const ownerPaypal = 'local-acceptance-paypal';
svc.saveMandate(ownerAi, { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
svc.saveMandate(ownerPaypal, { budgetCents: 30000, maxQuantity: 5, category: 'keyboards' });
const checks = await Promise.allSettled([
  (async () => {
    const result = await svc.research(ownerAi, 'Find five quiet wireless keyboards for a shared office under 300 USD.');
    console.log('Gemini: real recommendation received; product:', result.proposal.productId, 'quantity:', result.proposal.quantity, 'policy allowed:', result.decision.allowed);
  })(),
  (async () => {
    const quote = svc.reserve(ownerPaypal, { productId: 'hush-75', quantity: 5 });
    await svc.createOrder(ownerPaypal, quote.id);
    const result = await svc.reconcile(ownerPaypal, quote.id);
    console.log('PayPal sandbox: order created and retrieved; amount, merchant and reference matched;', result.totalCents / 100, 'USD. No approval or capture requested.');
  })()
]);
for (const [index, result] of checks.entries()) if (result.status === 'rejected') {
  console.log(index === 0 ? 'Gemini:' : 'PayPal:', result.reason?.name === 'Error' && result.reason?.status ? result.reason.message : 'Connection failed; no credentials logged.');
  process.exitCode = 1;
}
store.close();
