// Pure policy evaluation only. Payment routes must also enforce ownership,
// reserve funds transactionally, and recheck policy before capture.
export function evaluatePurchase({ mandate, proposal, product, spentCents = 0, reservedCents = 0, now = Date.now() }) {
  const reasons = [];
  const reject = (reason) => reasons.push(reason);
  const nonnegative = (n) => Number.isSafeInteger(n) && n >= 0;
  const positive = (n) => Number.isSafeInteger(n) && n > 0;
  if (!mandate || !proposal || !product) {
    return { allowed: false, reasons: ['MISSING_TRUSTED_DATA'], totalCents: null };
  }
  if (mandate.active !== true) reject('MANDATE_INACTIVE');
  if (!Number.isFinite(now) || !Number.isFinite(mandate.expiresAt) || mandate.expiresAt <= now) reject('MANDATE_EXPIRED');
  if (mandate.requireApproval !== true) reject('BUYER_APPROVAL_REQUIRED');
  if (mandate.currency !== 'USD' || product.currency !== mandate.currency) reject('CURRENCY_NOT_ALLOWED');
  if (!Array.isArray(mandate.merchantIds) || !mandate.merchantIds.includes(product.merchantId)) reject('MERCHANT_NOT_ALLOWED');
  if (!Array.isArray(mandate.categories) || !mandate.categories.includes(product.category)) reject('CATEGORY_NOT_ALLOWED');
  if (typeof product.id !== 'string' || !product.id || proposal.productId !== product.id) reject('PRODUCT_MISMATCH');
  if (product.purchasable !== true) reject('PRODUCT_NOT_PURCHASABLE');
  if (!positive(proposal.quantity) || !positive(mandate.maxQuantity) || proposal.quantity > mandate.maxQuantity) reject('QUANTITY_NOT_ALLOWED');
  if (!nonnegative(product.stock) || proposal.quantity > product.stock) reject('INSUFFICIENT_STOCK');
  // Unit price, flat shipping, and final tax come only from the server's quote.
  const amounts = [product.unitPriceCents, product.shippingCents, product.taxCents,
    mandate.budgetCents, mandate.maxPurchaseCents, spentCents, reservedCents];
  let totalCents = null;
  if (!amounts.every(nonnegative) || !positive(proposal.quantity)) {
    reject('INVALID_AMOUNT');
  } else {
    totalCents = product.unitPriceCents * proposal.quantity + product.shippingCents + product.taxCents;
    const committed = spentCents + reservedCents;
    if (!nonnegative(totalCents) || !nonnegative(committed) || !nonnegative(totalCents + committed)) {
      totalCents = null;
      reject('INVALID_AMOUNT');
    } else {
      if (totalCents > mandate.maxPurchaseCents) reject('PURCHASE_LIMIT_EXCEEDED');
      if (totalCents + committed > mandate.budgetCents) reject('BUDGET_EXCEEDED');
    }
  }
  return { allowed: reasons.length === 0, reasons, totalCents };
}
