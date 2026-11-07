import { AppError } from './providers.mjs';
import { catalog } from '../core/catalog.mjs';

const usd = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

// Preserve explicit counted items such as "5 Hush 75 Wireless" or "3 mice".
// Gemini handles the rest of the language. An ambiguous mapping needs clarification.
export function preserveCountedItems(query, lines) {
  const aliases = { keyboards: 'keyboards?', mice: 'mice|mouse', headsets: 'headsets?', webcams: 'webcams?', hubs: '(?:USB )?hubs?', monitors: 'monitors?' };
  const names = catalog.map(p => ({ pattern: p.name, category: p.category, product: p }));
  const terms = [...names, ...Object.entries(aliases).map(([category, pattern]) => ({ category, pattern }))];
  for (const { category, pattern, product } of terms) {
    const regex = new RegExp(`(?:^|[^$\\w.])(\\d+)\\s*(?:[x×]\\s*)?(?:${pattern})\\b`, 'gi');
    for (const match of query.matchAll(regex)) {
      const count = Number(match[1]);
      let candidates = lines.filter(l => l.parsedRequest.category === category && (l.parsedRequest.quantity ?? 1) === count);
      if (product && candidates.length > 1) {
        candidates = candidates.filter(l => l.parsedRequest.productQuery.toLowerCase().includes(product.name.toLowerCase()));
      }
      if (candidates.length !== 1) throw new AppError('The comparison could not identify every requested item and quantity. Please name each item on a separate line.', 409);
      if (product) {
        const request = candidates[0].parsedRequest;
        if (request.requiredProductId && request.requiredProductId !== product.id) throw new AppError('Two requested products were combined into one line. Please list them separately.', 409);
        request.requiredProductId = product.id;
      }
    }
  }
}

export function compareOffers(products, answer, evaluate) {
  const { parsedRequest, rankedOffers } = answer;
  const quantity = parsedRequest.quantity ?? 1;
  const byId = new Map(products.map(product => [product.id, product]));
  if (rankedOffers.length !== byId.size || new Set(rankedOffers.map(o => o.productId)).size !== byId.size) {
    throw new AppError('The comparison did not cover every listing. Please retry.', 502);
  }
  const candidates = rankedOffers.map(offer => {
    const product = byId.get(offer.productId);
    if (!product || offer.evidence.length !== parsedRequest.requirements.length) {
      throw new AppError('The comparison could not be matched to the catalog. Please retry.', 502);
    }
    const facts = [product.name, product.description, ...product.tags];
    const features = parsedRequest.requirements.map((feature, index) => {
      const quote = offer.evidence[index];
      const confirmed = quote && facts.some(fact => fact.toLowerCase().includes(quote.toLowerCase()));
      return { feature, evidence: confirmed ? quote : null };
    });
    const proposal = { productId: product.id, quantity };
    const checked = evaluate(proposal, product);
    const { reasons, totalCents } = checked.decision;
    const policyReasons = reasons.filter(reason => !reason.startsWith('REQUEST_'));
    const requestReasons = reasons.filter(reason => reason.startsWith('REQUEST_'));
    if (parsedRequest.requiredProductId && product.id !== parsedRequest.requiredProductId) requestReasons.push('REQUEST_PRODUCT_MISMATCH');
    const featureFit = product.category === parsedRequest.category && !requestReasons.includes('REQUEST_PRODUCT_MISMATCH') && features.every(f => f.evidence);
    const row = {
      productId: product.id, name: product.name, description: product.description, quantity,
      totalCents, features, featureFit, requestReasons, policyReasons,
      overBudgetCents: parsedRequest.budgetCents !== null && (!parsedRequest.currency || parsedRequest.currency === 'USD')
        ? Math.max(0, totalCents - parsedRequest.budgetCents) : null,
    };
    return { row, proposal, checked };
  });
  const fits = candidates.filter(c => c.row.featureFit && c.row.requestReasons.length === 0);
  const selected = fits.find(c => c.checked.decision.allowed) ?? fits[0];
  const rows = candidates.map(c => c.row);
  if (selected) {
    const { row, proposal, checked } = selected;
    const explanation = `${quantity} × ${row.name} totals ${usd(row.totalCents)}. ${row.description}`;
    return { rows, selected: { proposal: { ...proposal, explanation }, ...checked } };
  }
  const closest = rows.filter(row => row.featureFit && row.overBudgetCents > 0 &&
    row.requestReasons.every(reason => reason === 'REQUEST_BUDGET_EXCEEDED'))
    .sort((a, b) => a.totalCents - b.totalCents)[0];
  let message = 'No listing in the approved category confirms all requested features within your constraints.';
  if (!products.some(p => p.category === parsedRequest.category)) {
    message = 'The requested product is outside this mandate’s catalog category.';
  } else if (parsedRequest.currency && parsedRequest.currency !== 'USD') {
    message = 'This store prices products in USD. The requested currency is unavailable.';
  } else if (closest) {
    message = `The lowest-priced option with the requested features is ${closest.name} at ${usd(closest.totalCents)} for ${quantity}, which is ${usd(closest.overBudgetCents)} above your budget.`;
  }
  return { rows, selected: null, message };
}
