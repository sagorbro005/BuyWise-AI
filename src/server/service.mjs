import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { catalog, discover, attackListing, inspectListing } from '../core/catalog.mjs';
import { evaluatePurchase } from '../core/policy.mjs';
import { AppError, recommend, paypalProvider } from './providers.mjs';
import { sealDecision, verifyDecision } from './decision-evidence.mjs';

const mandateInput = z.object({
  name: z.string().trim().min(1).max(80).default('Office purchasing'),
  budgetCents: z.number().int().min(100).max(100000),
  maxPurchaseCents: z.number().int().positive().optional(),
  durationHours: z.number().int().min(1).max(168).default(24),
  maxQuantity: z.number().int().min(1).max(50),
  category: z.enum(['keyboards', 'mice', 'headsets']),
  merchantIds: z.array(z.literal('buywise-sandbox')).max(1).default(['buywise-sandbox']),
}).strict().refine(m => (m.maxPurchaseCents ?? m.budgetCents) <= m.budgetCents);
const proposalInput = z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100), explanation: z.string().max(1500).optional() }).strict();
const reservedStates = ['reserved', 'creating', 'order_created', 'capture_pending', 'review_required'];
export function createService(store, paypal = paypalProvider(), ai = recommend, clock = Date.now) {
  const event = (owner, kind, title, detail, intentId = null, evidence = {}) => store.put('event', { id: randomUUID(), owner, kind, title, detail, intentId, createdAt: clock(), ...evidence });
  function owned(kind, id, owner) {
    const record = store.get(kind, id);
    if (!record || record.owner !== owner) throw new AppError('Record not found.', 404);
    return record;
  }
  function mandate(owner) {
    const m = store.get('mandate', owner);
    if (!m) throw new AppError('Confirm your spending mandate first.');
    return m;
  }
  function balances(owner, excluding) {
    return store.list('intent', owner).filter(i => i.id !== excluding).reduce((sum, i) => {
      if (i.status === 'captured') sum.spentCents += i.totalCents;
      if (reservedStates.includes(i.status)) sum.reservedCents += i.totalCents;
      return sum;
    }, { spentCents: 0, reservedCents: 0 });
  }
  function releaseExpired(owner) {
    for (const i of store.list('intent', owner)) {
      if (['reserved', 'order_created'].includes(i.status) && i.expiresAt <= clock() && i.lockUntil <= clock()) {
        store.put('intent', { ...i, status: 'expired' });
        event(owner, 'policy', 'Purchase permission expired', 'Unused reservation released.', i.id);
      }
    }
  }
  function persistMandate(record, title) {
    const timestamp = clock();
    store.put('mandate', record);
    store.put('mandate-version', { ...record, id: record.owner + '/' + record.version, timestamp, change: title });
    event(record.owner, 'policy', title, 'Version ' + record.version + ' · ' + (record.name || 'Office purchasing'));
    return record;
  }
  function evaluate(owner, proposal, product, stage, intent, parsedRequest) {
    const rules = mandate(owner);
    const funds = balances(owner, intent?.id);
    const now = clock();
    const decision = evaluatePurchase({ mandate: rules, proposal, product, ...funds, now });
    const findings = inspectListing(product?.description || '');
    if (findings.length) decision.reasons.push('SUSPICIOUS_LISTING');
    if (intent && rules.version !== intent.mandateVersion) decision.reasons.push('MANDATE_CHANGED');
    if (intent && now >= intent.expiresAt) decision.reasons.push('QUOTE_EXPIRED');
    if (intent && decision.totalCents !== intent.totalCents) decision.reasons.push('QUOTE_MISMATCH');
    if (parsedRequest) {
      if (parsedRequest.quantity != null && parsedRequest.quantity !== proposal.quantity) decision.reasons.push('REQUEST_QUANTITY_MISMATCH');
      if (parsedRequest.budgetCents != null && decision.totalCents > parsedRequest.budgetCents) decision.reasons.push('REQUEST_BUDGET_EXCEEDED');
      if (parsedRequest.currency && parsedRequest.currency !== rules.currency) decision.reasons.push('REQUEST_CURRENCY_MISMATCH');
      if (parsedRequest.category !== product?.category) decision.reasons.push('REQUEST_CATEGORY_MISMATCH');
    }
    decision.outcome = decision.reasons.length === 0 ? 'APPROVED_FOR_REVIEW'
      : decision.reasons.every(reason => reason === 'SUSPICIOUS_LISTING') ? 'REQUIRES_REVIEW' : 'BLOCKED';
    decision.allowed = decision.reasons.length === 0;
    const sealed = sealDecision({
      mandate: rules, stage, evaluatedAt: now, proposal, product: product ?? null,
      balances: funds, findings, decision, parsedRequest: parsedRequest ?? null,
      quote: intent ? { expiresAt: intent.expiresAt, totalCents: intent.totalCents, mandateVersion: intent.mandateVersion } : null,
    });
    return { decision, sealed };
  }
  // Allow policy denials to commit their audit record before raising the HTTP
  // error. Unexpected failures still roll back the entire transaction.
  function policyTransaction(fn) {
    const result = store.transaction(fn);
    if (result instanceof AppError) throw result;
    return result;
  }
  function checkIntent(owner, intent, stage) {
    const { decision, sealed } = evaluate(owner, { productId: intent.productId, quantity: intent.quantity }, intent.quote, stage, intent);
    event(owner, decision.allowed ? 'policy' : 'blocked', stage + ' policy check', decision.allowed ? 'Allowed' : decision.reasons.join(', '), intent.id, sealed);
    if (!decision.allowed) return new AppError('Purchase blocked: ' + decision.reasons.join(', ').toLowerCase(), 409);
  }
  function matchOrder(intent, order) {
    const units = order.purchase_units;
    if (order.id !== intent.orderId || order.intent !== 'CAPTURE' || units?.length !== 1) throw new AppError('PayPal order does not match this purchase.', 409);
    const unit = units[0];
    if (unit.custom_id !== intent.id || unit.payee?.merchant_id !== paypal.merchantId() || unit.amount?.currency_code !== 'USD' || unit.amount?.value !== (intent.totalCents / 100).toFixed(2)) throw new AppError('PayPal order amount, merchant or reference mismatch.', 409);
    return unit;
  }
  function applyOrder(owner, id, order, verifiedEvent) {
    return store.transaction(() => {
      const intent = owned('intent', id, owner);
      if (verifiedEvent && store.get('webhook', verifiedEvent.id)) return intent;
      const unit = matchOrder(intent, order);
      const captures = unit.payments?.captures || [];
      if (captures.length > 1) throw new AppError('Multiple captures require manual review.', 409);
      const capture = captures[0];
      if (capture && (capture.amount?.currency_code !== 'USD' || capture.amount?.value !== (intent.totalCents / 100).toFixed(2))) throw new AppError('Capture amount mismatch.', 409);
      const wasCaptured = intent.status === 'captured';
      if (capture?.status === 'COMPLETED') {
        intent.status = 'captured'; intent.captureId = capture.id;
        if (!wasCaptured) event(owner, 'payment', 'Sandbox payment captured', `${intent.quantity} × ${intent.productName}. PayPal capture ${capture.id}.`, intent.id);
      } else if (!wasCaptured && capture?.status === 'PENDING') intent.status = 'capture_pending';
      else if (!wasCaptured && ['DECLINED', 'FAILED', 'DENIED'].includes(capture?.status)) intent.status = 'failed';
      // Never downgrade a completed payment based on a late event.
      if (verifiedEvent) {
        if (verifiedEvent.resource?.id !== capture?.id || verifiedEvent.resource?.amount?.currency_code !== 'USD' || verifiedEvent.resource?.amount?.value !== (intent.totalCents / 100).toFixed(2)) throw new AppError('Webhook capture does not match the purchase.', 409);
        if (verifiedEvent.event_type === 'PAYMENT.CAPTURE.COMPLETED' && capture?.status === 'COMPLETED') intent.webhookVerified = true;
        event(owner, 'verified', 'PayPal webhook verified', verifiedEvent.event_type + ' · ' + verifiedEvent.id, intent.id);
        store.put('webhook', { id: verifiedEvent.id, owner, eventType: verifiedEvent.event_type, receivedAt: clock() });
      }
      intent.lockUntil = 0;
      return store.put('intent', intent);
    });
  }
  return {
    snapshot(owner) {
      store.transaction(() => releaseExpired(owner));
      const events = store.list('event', owner).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
        .map(record => ({ ...record, evidenceVerified: verifyDecision(record) }));
      return { mandate: store.get('mandate', owner), ...balances(owner), products: catalog, intents: store.list('intent', owner).sort((a, b) => b.createdAt - a.createdAt), events };
    },
    saveMandate(owner, input) {
      const data = mandateInput.parse(input);
      return store.transaction(() => {
        releaseExpired(owner);
        if (balances(owner).reservedCents) throw new AppError('Resolve or cancel open purchases before changing your mandate.', 409);
        if (data.budgetCents < balances(owner).spentCents) throw new AppError('Your budget cannot be lower than completed spending.');
        const previous = store.get('mandate', owner);
        if (previous && !store.get('mandate-version', owner + '/' + previous.version))
          store.put('mandate-version', { ...previous, id: owner + '/' + previous.version, timestamp: null, change: 'Retained earlier version' });
        return persistMandate({ id: owner, owner, name: data.name, active: true, version: (previous?.version || 0) + 1, durationHours: data.durationHours, expiresAt: clock() + data.durationHours * 3600000, requireApproval: true, currency: 'USD', merchantIds: data.merchantIds, categories: [data.category], maxQuantity: data.maxQuantity, budgetCents: data.budgetCents, maxPurchaseCents: data.maxPurchaseCents ?? data.budgetCents }, 'MANDATE confirmed');
      });
    },
    revoke(owner) {
      return store.transaction(() => {
        const rules = mandate(owner);
        if (!rules.active) return rules;
        if (!store.get('mandate-version', owner + '/' + rules.version))
          store.put('mandate-version', { ...rules, id: owner + '/' + rules.version, timestamp: null, change: 'Retained earlier version' });
        for (const i of store.list('intent', owner)) {
          if (['reserved', 'order_created'].includes(i.status))
            store.put('intent', { ...i, status: 'canceled' });
        }
        return persistMandate({ ...rules, active: false, version: rules.version + 1 }, 'MANDATE revoked');
      });
    },
    async research(owner, query) {
      if (typeof query !== 'string' || query.trim().length < 3 || query.length > 1000) throw new AppError('Use a shopping request between 3 and 1,000 characters.');
      const m = mandate(owner);
      const products = discover(query, m.categories[0]).filter(p => !inspectListing(p.description).length);
      const { parsedRequest, ...selection } = await ai({ query, mandate: m, products });
      const proposal = proposalInput.parse(selection);
      const product = catalog.find(p => p.id === proposal.productId);
      const { decision, sealed } = evaluate(owner, proposal, product, 'Recommendation', null, parsedRequest);
      event(owner, decision.allowed ? 'agent' : 'blocked', decision.allowed ? 'AI recommendation checked' : 'AI proposal blocked', decision.allowed ? proposal.explanation : decision.reasons.join(', '), null, sealed);
      const run = store.put('research', { id: randomUUID(), owner, proposal, parsedRequest: parsedRequest ?? null, decision, mandateVersion: m.version, model: process.env.GEMINI_MODEL || null, createdAt: clock() });
      return { recommendationId: run.id, parsedRequest, proposal, decision, products, source: 'gemini' };
    },
    attack(owner) {
      const proposal = { productId: attackListing.id, quantity: 50 };
      const detection = inspectListing(attackListing.description);
      const { decision, sealed } = evaluate(owner, proposal, attackListing, 'Attack test');
      event(owner, 'blocked', 'Attack test blocked', `Labeled test fixture. ${decision.reasons.join(', ')}. No PayPal order requested.`, null, sealed);
      return { listing: attackListing, proposal, detection, decision, paypalCalled: false, fixture: true };
    },
    reserve(owner, input) {
      const recommendation = input?.recommendationId
        ? owned('research', z.object({ recommendationId: z.string().uuid() }).strict().parse(input).recommendationId, owner)
        : null;
      const proposal = proposalInput.parse(recommendation?.proposal ?? input);
      return policyTransaction(() => {
        releaseExpired(owner);
        if (recommendation) {
          const currentRun = owned('research', recommendation.id, owner);
          if (currentRun.intentId) return owned('intent', currentRun.intentId, owner);
        }
        const product = catalog.find(p => p.id === proposal.productId);
        const { decision, sealed } = evaluate(owner, proposal, product, 'Purchase review', null, recommendation?.parsedRequest);
        if (recommendation && (!recommendation.decision.allowed || recommendation.mandateVersion !== mandate(owner).version))
          throw new AppError('Run research again under the current mandate before reviewing this recommendation.', 409);
        if (!decision.allowed) {
          event(owner, 'blocked', 'Purchase blocked', decision.reasons.join(', '), null, sealed);
          return new AppError(`Purchase blocked: ${decision.reasons.join(', ')}`, 409);
        }
        const existing = store.list('intent', owner).find(i => reservedStates.includes(i.status));
        if (existing) throw new AppError('Complete or cancel your open purchase before starting another.', 409);
        const intent = { id: randomUUID(), owner, productId: product.id, productName: product.name, quantity: proposal.quantity, quote: product, totalCents: decision.totalCents, mandateVersion: mandate(owner).version, createdAt: clock(), expiresAt: clock() + 15 * 60000, status: 'reserved', orderId: null, captureId: null, webhookVerified: false, lockUntil: 0 };
        store.put('intent', intent);
        if (recommendation) store.put('research', { ...recommendation, intentId: intent.id });
        event(owner, 'policy', 'Purchase cleared by AgentGuard', 'Budget reserved. Waiting for your PayPal approval.', intent.id, sealed);
        return intent;
      });
    },
    async createOrder(owner, id) {
      let intent = policyTransaction(() => {
        const i = owned('intent', id, owner);
        if (i.orderId) {
          if (i.status === 'captured') return i;
          if (i.status !== 'order_created') throw new AppError('This purchase cannot reopen checkout.', 409);
          const denial = checkIntent(owner, i, 'Reopen order');
          return denial || i;
        }
        if (!['reserved', 'creating'].includes(i.status)) throw new AppError('This purchase cannot create an order.', 409);
        if (i.status === 'reserved') {
          const denial = checkIntent(owner, i, 'Create order');
          if (denial) return denial;
        }
        // Recover an uncertain create using the same request ID, including after
        // quote expiry. Capture still requires a valid quote. Never retry beyond
        // PayPal's default idempotency retention window.
        if (i.status === 'creating' && clock() - i.createdAt > 5 * 3600000) throw new AppError('Order recovery needs manual review in the PayPal sandbox dashboard. No new order will be created.', 409);
        if (i.lockUntil > clock()) throw new AppError('Order creation is in progress. Wait a moment.', 409);
        i.status = 'creating'; i.lockUntil = clock() + 30000;
        return store.put('intent', i);
      });
      if (intent.orderId) return intent;
      try {
        const order = await paypal.create(intent);
        if (!order.id) throw new AppError('PayPal returned no order ID.', 502);
        return store.transaction(() => {
          intent = owned('intent', id, owner);
          intent.orderId = order.id;
          matchOrder(intent, order);
          intent.status = 'order_created'; intent.lockUntil = 0;
          store.put('order', { id: order.id, owner, intentId: id });
          store.put('intent', intent);
          event(owner, 'payment', 'PayPal sandbox order created', 'Buyer approval is required before capture.', id);
          return intent;
        });
      } catch (error) {
        store.transaction(() => { const i = owned('intent', id, owner); i.lockUntil = 0; store.put('intent', i); });
        throw error;
      }
    },
    async capture(owner, id) {
      let intent = owned('intent', id, owner);
      if (intent.status === 'captured') return intent;
      if (!intent.orderId) throw new AppError('Create the PayPal order first.');
      const order = await paypal.get(intent.orderId);
      matchOrder(intent, order);
      if (order.status === 'COMPLETED') return applyOrder(owner, id, order);
      if (order.status !== 'APPROVED') throw new AppError('Approve the payment in PayPal first.', 409);
      intent = policyTransaction(() => {
        const i = owned('intent', id, owner);
        if (!['order_created', 'capture_pending'].includes(i.status)) throw new AppError('This purchase is not available for capture.', 409);
        const denial = checkIntent(owner, i, 'Capture');
        if (denial) return denial;
        if (i.lockUntil > clock()) throw new AppError('Payment is processing. Check status shortly.', 409);
        i.status = 'capture_pending'; i.lockUntil = clock() + 30000;
        return store.put('intent', i);
      });
      try { return applyOrder(owner, id, await paypal.capture(intent)); }
      catch (error) {
        // Keep the budget reserved: PayPal may have succeeded before the timeout.
        store.transaction(() => { const i = owned('intent', id, owner); i.lockUntil = 0; store.put('intent', i); event(owner, 'pending', 'Payment needs reconciliation', 'Outcome is not confirmed. Budget remains reserved; check payment status.', id); });
        throw error;
      }
    },
    async reconcile(owner, id) {
      const intent = owned('intent', id, owner);
      if (!intent.orderId) throw new AppError('There is no known PayPal order yet. Retry checkout to recover the original order.');
      return applyOrder(owner, id, await paypal.get(intent.orderId));
    },
    cancel(owner, id) {
      return store.transaction(() => {
        const intent = owned('intent', id, owner);
        if (!['reserved', 'order_created'].includes(intent.status) || intent.lockUntil > clock()) throw new AppError('A processing or uncertain payment cannot be canceled. Check its payment status first.', 409);
        intent.status = 'canceled'; store.put('intent', intent);
        event(owner, 'policy', 'Purchase canceled', 'Local purchase permission revoked; reserved budget released. No capture will be initiated.', id);
        return intent;
      });
    },
    async webhook(headers, payload) {
      await paypal.verify(headers, payload);
      if (typeof payload.id !== 'string' || !payload.id) throw new AppError('Missing webhook event ID.');
      if (store.get('webhook', payload.id)) return { received: true, duplicate: true };
      if (payload.event_type === 'CHECKOUT.ORDER.APPROVED') {
        const reference = store.get('order', String(payload.resource?.id || ''));
        if (!reference) throw new AppError('Order mapping pending.', 503);
        const order = await paypal.get(reference.id);
        matchOrder(owned('intent', reference.intentId, reference.owner), order);
        if (!['APPROVED', 'COMPLETED'].includes(order.status)) throw new AppError('Approval reconciliation pending.', 503);
        return store.transaction(() => {
          if (store.get('webhook', payload.id)) return { received: true, duplicate: true };
          store.put('webhook', { id: payload.id, owner: reference.owner, eventType: payload.event_type, receivedAt: clock() });
          event(reference.owner, 'verified', 'Buyer approval verified', 'PayPal order ' + order.id, reference.intentId);
          return { received: true };
        });
      }
      if (!['PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED'].includes(payload.event_type)) return { received: true, ignored: true };
      const orderId = payload.resource?.supplementary_data?.related_ids?.order_id;
      const reference = typeof orderId === 'string' ? store.get('order', orderId) : null;
      if (!reference) throw new AppError('Order is not available for reconciliation yet.', 503);
      const order = await paypal.get(orderId);
      // A duplicate concurrently delivered after the first verification must not double count.
      if (store.get('webhook', payload.id)) return { received: true, duplicate: true };
      applyOrder(reference.owner, reference.intentId, order, payload);
      return { received: true };
    },
  };
}
