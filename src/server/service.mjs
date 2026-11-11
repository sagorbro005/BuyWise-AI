import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { catalog, discover, attackListing, buildCustomAttack, inspectListing } from '../core/catalog.mjs';
import { evaluatePurchase } from '../core/policy.mjs';
import { categoryIds } from '../core/categories.mjs';
import { compareOffers, preserveCountedItems } from './comparison.mjs';
import { evaluateBasket } from '../core/basket.mjs';
import { AppError, recommend, paypalProvider } from './providers.mjs';
import { sealDecision, verifyDecision } from './decision-evidence.mjs';

const noControlChars = (s) => {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
};
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const mandateInput = z.object({
  name: z.string().trim().min(1).max(80).refine(noControlChars, 'Control characters are not allowed.').default('Office purchasing'),
  budgetCents: z.number().int().min(100).max(100000),
  maxPurchaseCents: z.number().int().positive().optional(),
  durationHours: z.number().int().min(1).max(168).default(24),
  maxQuantity: z.number().int().min(1).max(50),
  category: z.enum(categoryIds).optional(),
  categories: z.array(z.enum(categoryIds)).min(1).max(categoryIds.length).optional(),
  categoryLimits: z.record(z.string(), z.number().int().min(1).max(50)).default({}),
  merchantIds: z.array(z.literal('buywise-sandbox')).max(1).default(['buywise-sandbox']),
}).strict().refine(m => {
  const categories = m.categories ?? (m.category ? [m.category] : []);
  return categories.length && !(m.category && m.categories) && new Set(categories).size === categories.length &&
    Object.keys(m.categoryLimits).every(id => !forbiddenKeys.has(id) && categories.includes(id) && m.categoryLimits[id] <= m.maxQuantity) &&
    (m.maxPurchaseCents ?? m.budgetCents) <= m.budgetCents;
});
const basketInput = z.object({ lines: z.array(z.object({
  productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(50),
}).strict()).min(1).max(6) }).strict();
const proposalInput = z.object({ productId: z.string().min(1).max(100), quantity: z.number().int().min(1).max(100), explanation: z.string().max(1500).optional() }).strict();
const attackInput = z.object({ description: z.string().trim().min(3).max(1000).optional() }).strict();
const attackWebhookInput = z.object({ scenario: z.enum(['replay', 'tamper']) }).strict();
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
    const { decision, sealed } = intent.lines
      ? basketCheck(owner, intent.lines, stage, intent.basketRequest, intent)
      : evaluate(owner, { productId: intent.productId, quantity: intent.quantity }, intent.quote, stage, intent);
    event(owner, decision.allowed ? 'policy' : 'blocked', stage + ' policy check', decision.allowed ? 'Allowed' : decision.reasons.join(', '), intent.id, sealed);
    if (!decision.allowed) return new AppError('Purchase blocked: ' + decision.reasons.join(', ').toLowerCase(), 409);
  }
  function basketCheck(owner, entries, stage, request, intent) {
    const rules = mandate(owner);
    const funds = balances(owner, intent?.id);
    const now = clock();
    const decision = evaluateBasket({ entries, mandate: rules, ...funds, now, ...request });
    if (intent && rules.version !== intent.mandateVersion) decision.reasons.push('MANDATE_CHANGED');
    if (intent && now >= intent.expiresAt) decision.reasons.push('QUOTE_EXPIRED');
    if (intent && intent.totalCents !== decision.totalCents) decision.reasons.push('QUOTE_MISMATCH');
    decision.allowed = !decision.reasons.length;
    const sealed = sealDecision({ mandate: rules, stage, evaluatedAt: now, lines: entries, balances: funds, decision, request });
    return { decision, sealed };
  }
  function reserveBasket(owner, input, run) {
    const parsed = basketInput.parse(input);
    return policyTransaction(() => {
      releaseExpired(owner);
      if (run) {
        const currentRun = owned('research', run.id, owner);
        if (currentRun.intentId) return owned('intent', currentRun.intentId, owner);
        if (!run.decision.allowed || run.mandateVersion !== mandate(owner).version) throw new AppError('Search again under the current mandate.', 409);
      }
      const entries = parsed.lines.map(line => {
        const product = catalog.find(p => p.id === line.productId);
        if (!product) throw new AppError('Unknown basket item.', 400);
        return { product, quantity: line.quantity };
      });
      const request = run?.basketRequest ?? {};
      const { decision, sealed } = basketCheck(owner, entries, 'Basket review', request);
      if (!decision.allowed) {
        event(owner, 'blocked', 'Basket blocked', decision.reasons.join(', '), null, sealed);
        return new AppError(`Basket blocked: ${decision.reasons.join(', ')}`, 409);
      }
      if (store.list('intent', owner).some(i => reservedStates.includes(i.status))) throw new AppError('Resolve the open purchase first.', 409);
      const createdAt = clock();
      const rules = mandate(owner);
      const intent = { id: randomUUID(), owner, lines: entries, basketRequest: request, quantity: decision.quantity,
        productName: entries.map(e => `${e.quantity} × ${e.product.name}`).join(' + '),
        totalCents: decision.totalCents, mandateVersion: rules.version, mandateName: rules.name || 'Office purchasing',
        mandateSha256: sealed.evidence.mandateSha256, decisionEvidenceSha256: sealed.evidenceSha256, createdAt,
        expiresAt: createdAt + 15 * 60000, status: 'reserved', orderId: null, captureId: null, capturedAt: null,
        webhookVerified: false, webhookEventId: null, webhookEventType: null, webhookVerifiedAt: null, lockUntil: 0 };
      store.put('intent', intent);
      if (run) store.put('research', { ...run, intentId: intent.id });
      event(owner, 'policy', 'Basket cleared by AgentGuard', 'Combined amount reserved for buyer approval.', intent.id, sealed);
      return intent;
    });
  }
  function mixedResearch(owner, rules, products, answer) {
    const request = { budgetCents: answer.basketBudgetCents, currency: answer.basketCurrency,
      requests: answer.lines.map(line => line.parsedRequest) };
    const groups = answer.lines.map(line => {
      const parsed = line.parsedRequest;
      const options = products.filter(product => product.category === parsed.category);
      const comparison = compareOffers(options, line, (proposal, product) =>
        evaluate(owner, proposal, product, 'Basket comparison', null, parsed));
      return { id: randomUUID(), request: parsed, rows: comparison.rows };
    });
    let best;
    const funds = balances(owner);
    const now = clock();
    // At most six lines and three offers per category in this store.
    function visit(index, entries, rank) {
      if (index < groups.length) {
        groups[index].rows.forEach((row, preference) => {
          if (!row.featureFit || row.requestReasons.length) return;
          const product = products.find(p => p.id === row.productId);
          visit(index + 1, [...entries, { product, quantity: row.quantity }], rank + preference);
        });
        return;
      }
      const decision = evaluateBasket({ entries, mandate: rules, ...funds, now, ...request });
      // Suggest a permitted combination first. Among permitted combinations
      // prefer Gemini's rankings, with total cost as the tie breaker.
      const score = [decision.allowed ? 0 : 1, decision.allowed ? rank : decision.reasons.length,
        decision.totalCents, rank];
      const firstDifference = best && score.findIndex((value, i) => value !== best.score[i]);
      if (!best || (firstDifference >= 0 && score[firstDifference] < best.score[firstDifference])) {
        best = { score, entries, decision };
      }
    }
    visit(0, [], 0);
    const result = { kind: 'basket', groups, basketRequest: request, source: 'gemini', recommendationId: null };
    if (!best) {
      const missing = groups.filter(g => !g.rows.some(r => r.featureFit && !r.requestReasons.length));
      const message = 'No suitable option for: ' + missing.map(g => g.request.productQuery).join(', ') + '. The entire basket is on hold.';
      event(owner, 'agent', 'No complete basket', message);
      return { ...result, outcome: 'no_match', message, entries: [] };
    }
    const { entries } = best;
    const { decision, sealed } = basketCheck(owner, entries, 'Basket recommendation', request);
    const lines = entries.map(e => ({ productId: e.product.id, quantity: e.quantity }));
    const outcome = decision.allowed ? 'match' : 'blocked';
    event(owner, decision.allowed ? 'agent' : 'blocked', 'Basket recommendation checked',
      decision.allowed ? 'All requested lines fit.' : decision.reasons.join(', '), null, sealed);
    if (decision.allowed) {
      const run = store.put('research', { id: randomUUID(), owner, lines, decision, mandateVersion: rules.version,
        basketRequest: request, createdAt: now });
      result.recommendationId = run.id;
    }
    const ceilings = [rules.maxPurchaseCents, rules.budgetCents - funds.spentCents - funds.reservedCents];
    if (request.budgetCents != null) ceilings.push(request.budgetCents);
    const excess = decision.totalCents - Math.min(...ceilings);
    const message = !decision.allowed && excess > 0
      ? `This complete basket exceeds the spending limit by $${(excess / 100).toFixed(2)}. Nothing has been reserved.`
      : undefined;
    return { ...result, entries, decision, outcome, message, spendingLimitCents: Math.min(...ceilings) };
  }
  function matchOrder(intent, order, requireItems = false) {
    const units = order.purchase_units;
    if (order.id !== intent.orderId || order.intent !== 'CAPTURE' || units?.length !== 1) throw new AppError('PayPal order does not match this purchase.', 409);
    const unit = units[0];
    if (intent.lines && requireItems && !Array.isArray(unit.items)) throw new AppError('PayPal basket details are missing. Capture is blocked.', 409);
    if (unit.custom_id !== intent.id || unit.payee?.merchant_id !== paypal.merchantId() || unit.amount?.currency_code !== 'USD' || unit.amount?.value !== (intent.totalCents / 100).toFixed(2)) throw new AppError('PayPal order amount, merchant or reference mismatch.', 409);
    if (intent.lines && unit.items) {
      const signature = (sku, qty, currency, price) => JSON.stringify([sku, String(qty), currency, price]);
      const expected = intent.lines.map(({ product, quantity }) => signature(product.id, quantity, product.currency, (product.unitPriceCents / 100).toFixed(2))).sort();
      const received = unit.items.map(item => signature(item.sku, item.quantity, item.unit_amount?.currency_code, item.unit_amount?.value)).sort();
      if (JSON.stringify(expected) !== JSON.stringify(received)) throw new AppError('PayPal basket items do not match the approved purchase.', 409);
    }
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
        intent.status = 'captured'; intent.captureId = capture.id; intent.capturedAt ??= clock();
        if (!wasCaptured) event(owner, 'payment', 'Sandbox payment captured', `${intent.lines ? intent.productName : `${intent.quantity} × ${intent.productName}`}. PayPal capture ${capture.id}.`, intent.id);
      } else if (!wasCaptured && capture?.status === 'PENDING') intent.status = 'capture_pending';
      else if (!wasCaptured && ['DECLINED', 'FAILED', 'DENIED'].includes(capture?.status)) intent.status = 'failed';
      // Never downgrade a completed payment based on a late event.
      if (verifiedEvent) {
        if (verifiedEvent.resource?.id !== capture?.id || verifiedEvent.resource?.amount?.currency_code !== 'USD' || verifiedEvent.resource?.amount?.value !== (intent.totalCents / 100).toFixed(2)) throw new AppError('Webhook capture does not match the purchase.', 409);
        if (verifiedEvent.event_type === 'PAYMENT.CAPTURE.COMPLETED' && capture?.status === 'COMPLETED') {
          intent.webhookVerified = true;
          intent.webhookEventId = verifiedEvent.id;
          intent.webhookEventType = verifiedEvent.event_type;
          intent.webhookVerifiedAt = clock();
        }
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
        return persistMandate({ id: owner, owner, name: data.name, active: true, version: (previous?.version || 0) + 1, durationHours: data.durationHours, expiresAt: clock() + data.durationHours * 3600000, requireApproval: true, currency: 'USD', merchantIds: data.merchantIds, categories: data.categories ?? [data.category], categoryLimits: data.categoryLimits, maxQuantity: data.maxQuantity, budgetCents: data.budgetCents, maxPurchaseCents: data.maxPurchaseCents ?? data.budgetCents }, 'MANDATE confirmed');
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
      const products = m.categories.flatMap(category => discover(query, category)).filter(p => !inspectListing(p.description).length);
      const rawAnswer = await ai({ query, mandate: m, products });
      if (mandate(owner).version !== m.version) throw new AppError('Your mandate changed during research. Search again.', 409);
      if (rawAnswer.lines) preserveCountedItems(query, rawAnswer.lines);
      if (rawAnswer.lines?.length > 1) return mixedResearch(owner, m, products, rawAnswer);
      const answer = rawAnswer.lines?.[0] ?? rawAnswer;
      if (rawAnswer.lines) {
        const parsed = answer.parsedRequest;
        const limits = [parsed.budgetCents, rawAnswer.basketBudgetCents].filter(n => n != null);
        parsed.budgetCents = limits.length ? Math.min(...limits) : null;
        parsed.currency ??= rawAnswer.basketCurrency;
      }
      const { parsedRequest } = answer;
      const comparison = compareOffers(rawAnswer.lines ? products.filter(p => p.category === parsedRequest.category) : products, answer, (proposal, product) =>
        evaluate(owner, proposal, product, 'Recommendation', null, parsedRequest));
      if (!comparison.selected) {
        event(owner, 'agent', 'No suitable match', comparison.message);
        return { outcome: 'no_match', message: comparison.message, parsedRequest, rows: comparison.rows, proposal: null, recommendationId: null, source: 'gemini' };
      }
      const { proposal, decision, sealed } = comparison.selected;
      event(owner, decision.allowed ? 'agent' : 'blocked', decision.allowed ? 'AI recommendation checked' : 'AI proposal blocked', decision.allowed ? proposal.explanation : decision.reasons.join(', '), null, sealed);
      const run = store.put('research', { id: randomUUID(), owner, proposal, parsedRequest: parsedRequest ?? null, decision, mandateVersion: m.version, model: process.env.GEMINI_MODEL || null, createdAt: clock() });
      return { outcome: decision.allowed ? 'match' : 'blocked', recommendationId: run.id, parsedRequest, proposal, decision, rows: comparison.rows, products, source: 'gemini' };
    },
    attack(owner, input = {}) {
      const parsed = attackInput.parse(input ?? {});
      const m = mandate(owner);
      const isCustom = Boolean(parsed.description);
      const { listing, proposal } = isCustom
        ? buildCustomAttack(parsed.description, m.categories[0])
        : { listing: attackListing, proposal: { productId: attackListing.id, quantity: 50 } };
      const detection = inspectListing(listing.description);
      const evaluated = evaluate(owner, proposal, listing, isCustom ? 'Custom attack test' : 'Attack test');
      let { decision, sealed } = evaluated;
      // An unverified custom paste never exists in the trusted server catalog.
      if (isCustom && decision.allowed) {
        decision = { ...decision, allowed: false, outcome: 'BLOCKED', reasons: [...decision.reasons, 'PRODUCT_NOT_IN_CATALOG'] };
        sealed = sealDecision({
          mandate: m, stage: 'Custom attack test', evaluatedAt: clock(), proposal,
          product: listing, balances: balances(owner), findings: detection, decision, parsedRequest: null, quote: null,
        });
      }
      event(owner, 'blocked', isCustom ? 'Custom attack test blocked' : 'Attack test blocked',
        `${isCustom ? 'Custom untrusted listing test.' : 'Labeled test fixture.'} ${decision.reasons.join(', ')}. No PayPal order requested.`, null, sealed);
      return { listing, proposal, detection, decision, paypalCalled: false, fixture: !isCustom };
    },
    attackWebhook(owner, input = {}) {
      const parsed = attackWebhookInput.parse(input);
      const m = mandate(owner);
      const existingIntents = store.list('intent', owner).sort((a, b) => b.createdAt - a.createdAt);
      const now = clock();

      if (parsed.scenario === 'replay') {
        const verifiedIntent = existingIntents.find(i =>
          i.status === 'captured' && i.webhookVerified && i.webhookEventId && store.get('webhook', i.webhookEventId)
        );
        if (!verifiedIntent) {
          throw new AppError('Replay testing requires a confirmed PayPal purchase with a verified webhook event first.', 409);
        }

        const targetEventId = verifiedIntent.webhookEventId;
        const storedWebhook = store.get('webhook', targetEventId);
        const mockPayload = {
          id: targetEventId,
          event_version: '1.0',
          create_time: new Date(storedWebhook.receivedAt || verifiedIntent.webhookVerifiedAt || now).toISOString(),
          resource_type: 'capture',
          event_type: verifiedIntent.webhookEventType || 'PAYMENT.CAPTURE.COMPLETED',
          summary: 'Payment capture completed for purchase',
          resource: {
            id: verifiedIntent.captureId,
            status: 'COMPLETED',
            amount: {
              currency_code: 'USD',
              value: (verifiedIntent.totalCents / 100).toFixed(2),
            },
            supplementary_data: {
              related_ids: {
                order_id: verifiedIntent.orderId,
              },
            },
          },
        };

        const isDuplicate = Boolean(store.get('webhook', mockPayload.id));
        if (!isDuplicate) {
          throw new AppError('Expected recorded webhook event was not found in store.', 409);
        }

        const guardStatus = `FAIL_CLOSED: Duplicate event ${targetEventId} ignored (idempotency preserved)`;
        const reasons = ['DUPLICATE_WEBHOOK_EVENT', 'IDEMPOTENCY_LOCK_ACTIVE', 'FAIL_CLOSED'];
        const detail = `Real webhook event ${targetEventId} for order ${verifiedIntent.orderId} is already sealed in your ledger. Re-transmission dropped immediately by idempotency guard. Zero double-counting.`;

        const sealed = sealDecision({
          mandate: m,
          stage: 'Webhook replay defense',
          evaluatedAt: now,
          scenario: 'replay',
          intentId: verifiedIntent.id,
          targetEventId,
          guardStatus,
          reasons,
          duplicateDetected: isDuplicate,
        });

        event(owner, 'blocked', 'Webhook replay attack thwarted',
          `${guardStatus}. Replay of real order ${verifiedIntent.orderId} dropped before ledger mutation. Available budget untouched.`,
          verifiedIntent.id, sealed);

        return {
          scenario: 'replay',
          targetEventId,
          outcome: 'BLOCKED',
          guardStatus,
          reasons,
          detail,
          payloadSample: mockPayload,
          stateMutated: false,
          paypalCalled: false,
        };
      }

      // scenario === 'tamper'
      const capturedIntent = existingIntents.find(i => i.status === 'captured' && i.orderId && i.captureId);
      if (!capturedIntent) {
        throw new AppError('Tamper testing requires a completed PayPal Sandbox purchase capture first.', 409);
      }

      const targetOrderId = capturedIntent.orderId;
      const authorizedAmount = (capturedIntent.totalCents / 100).toFixed(2);
      const tamperedAmount = ((capturedIntent.totalCents * 2) / 100).toFixed(2);
      const targetEventId = 'WH-FORGED-TAMPER-TEST';

      const mockPayload = {
        id: targetEventId,
        event_version: '1.0',
        create_time: new Date(now).toISOString(),
        resource_type: 'capture',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        summary: 'Payment capture completed with altered amount',
        resource: {
          id: capturedIntent.captureId,
          status: 'COMPLETED',
          amount: {
            currency_code: 'USD',
            value: tamperedAmount,
          },
          supplementary_data: {
            related_ids: {
              order_id: targetOrderId,
            },
          },
        },
      };

      const headersSample = {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FORGED-INVALID',
        'paypal-transmission-id': 'TX-FORGED-SIGNATURE-TEST',
        'paypal-transmission-sig': 'FORGED_INVALID_HASH_DIGEST==',
        'paypal-transmission-time': new Date(now).toISOString(),
      };

      const guardStatus = 'REJECTED: Verification hash mismatch';
      const reasons = ['SIGNATURE_VERIFICATION_FAILED', 'AMOUNT_TAMPERING_DETECTED', 'FAIL_CLOSED'];
      const detail = `Forged webhook targeting your real order ${targetOrderId} claimed $${tamperedAmount} (tampered from confirmed $${authorizedAmount}) with an invalid signature. AgentGuard rejected the payload immediately.`;

      const sealed = sealDecision({
        mandate: m,
        stage: 'Webhook signature & tamper defense',
        evaluatedAt: now,
        scenario: 'tamper',
        intentId: capturedIntent.id,
        targetEventId,
        guardStatus,
        authorizedAmount,
        tamperedAmount,
        reasons,
      });

      event(owner, 'blocked', 'Tampered webhook payload rejected',
        `${guardStatus}. Tampered capture amount ($${tamperedAmount} vs authorized $${authorizedAmount}) for order ${targetOrderId}. Ledger untouched.`,
        capturedIntent.id, sealed);

      return {
        scenario: 'tamper',
        targetEventId,
        tamperedField: `resource.amount.value ($${authorizedAmount} -> $${tamperedAmount}) & forged transmission signature`,
        outcome: 'REJECTED',
        guardStatus,
        reasons,
        detail,
        payloadSample: mockPayload,
        headersSample,
        stateMutated: false,
        paypalCalled: false,
      };
    },
    reserve(owner, input) {
      const recommendation = input?.recommendationId
        ? owned('research', z.object({ recommendationId: z.string().uuid() }).strict().parse(input).recommendationId, owner)
        : null;
      if (recommendation?.lines) return reserveBasket(owner, { lines: recommendation.lines }, recommendation);
      if (input?.lines) return reserveBasket(owner, input);
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
        const rules = mandate(owner);
        const now = clock();
        const intent = { id: randomUUID(), owner, productId: product.id, productName: product.name, quantity: proposal.quantity, quote: product, totalCents: decision.totalCents, mandateVersion: rules.version, mandateName: rules.name || 'Office purchasing', mandateSha256: sealed.evidence.mandateSha256, decisionEvidenceSha256: sealed.evidenceSha256, createdAt: now, expiresAt: now + 15 * 60000, status: 'reserved', orderId: null, captureId: null, capturedAt: null, webhookVerified: false, webhookEventId: null, webhookEventType: null, webhookVerifiedAt: null, lockUntil: 0 };
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
      matchOrder(intent, order, true);
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
        store.transaction(() => {
          const i = owned('intent', id, owner);
          i.lockUntil = 0;
          store.put('intent', i);
          if (i.status !== 'captured') event(owner, 'pending', 'Payment needs reconciliation', 'Outcome is not confirmed. Budget remains reserved; check payment status.', id);
        });
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
      if (typeof payload?.id !== 'string' || !payload.id || payload.id.length > 128 || typeof payload?.event_type !== 'string' || !payload.event_type || payload.event_type.length > 100) {
        throw new AppError('Malformed webhook payload.');
      }
      await paypal.verify(headers, payload);
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
