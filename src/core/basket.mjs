import { evaluatePurchase } from './policy.mjs';
import { inspectListing } from './catalog.mjs';

// Entries are server-resolved catalog snapshots. Aggregate repeated SKUs and categories.
export function evaluateBasket({ entries, mandate, spentCents, reservedCents, now, budgetCents, currency }) {
  const reasons = new Set();
  const skuCounts = new Map();
  const categoryCounts = new Map();
  let quantity = 0;
  let totalCents = 0;
  for (const { product, quantity: count } of entries) {
    const check = evaluatePurchase({ mandate, product, proposal: { productId: product.id, quantity: count }, spentCents, reservedCents, now });
    for (const reason of check.reasons) reasons.add(reason);
    if (inspectListing(product.description).length) reasons.add('SUSPICIOUS_LISTING');
    const skuCount = (skuCounts.get(product.id) ?? 0) + count;
    const categoryCount = (categoryCounts.get(product.category) ?? 0) + count;
    skuCounts.set(product.id, skuCount);
    categoryCounts.set(product.category, categoryCount);
    if (skuCount > product.stock) reasons.add('INSUFFICIENT_STOCK');
    if (categoryCount > (mandate.categoryLimits?.[product.category] ?? Infinity)) reasons.add('CATEGORY_QUANTITY_EXCEEDED');
    totalCents += check.totalCents ?? 0;
    quantity += count;
  }
  if (!entries.length || !Number.isSafeInteger(totalCents)) reasons.add('INVALID_AMOUNT');
  if (quantity > mandate.maxQuantity) reasons.add('QUANTITY_NOT_ALLOWED');
  if (totalCents > mandate.maxPurchaseCents) reasons.add('PURCHASE_LIMIT_EXCEEDED');
  if (totalCents + spentCents + reservedCents > mandate.budgetCents) reasons.add('BUDGET_EXCEEDED');
  if (budgetCents != null && totalCents > budgetCents) reasons.add('REQUEST_BUDGET_EXCEEDED');
  if (currency && currency !== mandate.currency) reasons.add('REQUEST_CURRENCY_MISMATCH');
  return { allowed: reasons.size === 0, reasons: [...reasons], totalCents, quantity };
}
