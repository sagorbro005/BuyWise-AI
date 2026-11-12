import { evaluatePurchase } from './policy.mjs';
import { evaluateBasket } from './basket.mjs';

const REPLAY_EXCLUDE_STATUSES = new Set(['canceled', 'expired', 'failed']);

function computeCatalogSurface(mandate, products, now) {
  let surfaceCents = 0;
  let allowedCount = 0;
  const rows = [];

  for (const product of products) {
    const check = evaluatePurchase({
      mandate,
      proposal: { productId: product.id, quantity: 1 },
      product,
      spentCents: 0,
      reservedCents: 0,
      now,
    });
    if (check.allowed) {
      allowedCount++;
      const catLimit = mandate.categoryLimits?.[product.category] ?? mandate.maxQuantity;
      const budgetBound = Math.min(mandate.maxPurchaseCents, mandate.budgetCents);
      const maxUnitsByPrice = product.unitPriceCents > 0
        ? Math.floor((budgetBound - product.shippingCents - product.taxCents) / product.unitPriceCents)
        : 0;
      const maxUnits = Math.max(0, Math.min(product.stock, mandate.maxQuantity, catLimit, maxUnitsByPrice));
      surfaceCents += maxUnits * product.unitPriceCents + (maxUnits > 0 ? product.shippingCents + product.taxCents : 0);
    }
    rows.push({
      productId: product.id,
      name: product.name,
      category: product.category,
      unitPriceCents: product.unitPriceCents,
      allowed: check.allowed,
      reasons: check.reasons,
    });
  }

  return { surfaceCents, allowedCount, rows };
}

/**
 * Dry-run a candidate mandate against historical purchases and the full catalog
 * without persisting any state changes.
 */
export function simulatePolicy({
  candidateMandate,
  baselineMandate = null,
  intents = [],
  products = [],
  alreadyCommittedCents = 0,
  now = Date.now(),
}) {
  const effectiveBaseline = baselineMandate ?? {
    active: true,
    expiresAt: now + 24 * 3600000,
    requireApproval: true,
    currency: 'USD',
    merchantIds: ['buywise-sandbox'],
    categories: [...new Set(products.map(p => p.category))],
    categoryLimits: {},
    maxQuantity: 50,
    budgetCents: 100000,
    maxPurchaseCents: 100000,
  };

  const baselineCatalog = computeCatalogSurface(effectiveBaseline, products, now);
  const candidateCatalog = computeCatalogSurface(candidateMandate, products, now);

  let riskDeltaPct = 0;
  if (baselineCatalog.surfaceCents > 0) {
    riskDeltaPct = Math.round(((baselineCatalog.surfaceCents - candidateCatalog.surfaceCents) / baselineCatalog.surfaceCents) * 100);
  } else if (candidateCatalog.surfaceCents > 0) {
    riskDeltaPct = -100;
  }

  const historicalPurchases = [];
  let runningSpentCents = 0;
  let blockedHistoricalCount = 0;
  let blockedSavingsCents = 0;

  // Replay historical intents chronologically to accurately detect cumulative budget exhaustion.
  const chronological = [...intents]
    .filter(i => !REPLAY_EXCLUDE_STATUSES.has(i.status))
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

  for (const intent of chronological) {
    let check;
    if (Array.isArray(intent.lines) && intent.lines.length > 0) {
      check = evaluateBasket({
        entries: intent.lines,
        mandate: candidateMandate,
        spentCents: runningSpentCents,
        reservedCents: 0,
        now,
      });
    } else if (intent.quote) {
      check = evaluatePurchase({
        mandate: candidateMandate,
        proposal: { productId: intent.productId, quantity: intent.quantity },
        product: intent.quote,
        spentCents: runningSpentCents,
        reservedCents: 0,
        now,
      });
    } else {
      continue;
    }

    if (check.allowed) {
      runningSpentCents += intent.totalCents;
    } else {
      blockedHistoricalCount++;
      blockedSavingsCents += intent.totalCents;
    }

    historicalPurchases.push({
      id: intent.id,
      productName: intent.productName,
      quantity: intent.quantity,
      totalCents: intent.totalCents,
      originalStatus: intent.status,
      wouldPass: check.allowed,
      reasons: check.reasons,
    });
  }

  const eligibleCatalog = candidateCatalog.rows.filter(r => r.allowed);
  const defaultUnitPriceCents = eligibleCatalog[0]?.unitPriceCents ?? products[0]?.unitPriceCents ?? 4900;

  const initialForecast = computeSpendForecast({
    budgetCents: candidateMandate.budgetCents,
    maxPurchaseCents: candidateMandate.maxPurchaseCents,
    maxQuantity: candidateMandate.maxQuantity,
    alreadyCommittedCents,
    unitPriceCents: defaultUnitPriceCents,
    quantity: Math.min(5, candidateMandate.maxQuantity),
    periods: 6,
  });

  return {
    dryRun: true,
    candidate: {
      name: candidateMandate.name,
      budgetCents: candidateMandate.budgetCents,
      maxPurchaseCents: candidateMandate.maxPurchaseCents,
      maxQuantity: candidateMandate.maxQuantity,
      durationHours: candidateMandate.durationHours,
      categories: candidateMandate.categories,
      merchantIds: candidateMandate.merchantIds,
    },
    catalogSummary: {
      totalSkus: products.length,
      allowedSkus: candidateCatalog.allowedCount,
      blockedSkus: products.length - candidateCatalog.allowedCount,
      baselineAllowedSkus: baselineCatalog.allowedCount,
      baselineSurfaceCents: baselineCatalog.surfaceCents,
      candidateSurfaceCents: candidateCatalog.surfaceCents,
      riskReductionPct: riskDeltaPct,
    },
    historicalSummary: {
      totalEvaluated: historicalPurchases.length,
      passedCount: historicalPurchases.length - blockedHistoricalCount,
      blockedCount: blockedHistoricalCount,
      blockedSavingsCents,
      items: historicalPurchases.reverse(),
    },
    catalogItems: candidateCatalog.rows,
    initialForecast,
  };
}

/**
 * Project recurring order burn-down over a series of purchasing cycles against a mandate.
 */
export function computeSpendForecast({
  budgetCents,
  maxPurchaseCents,
  maxQuantity = 50,
  alreadyCommittedCents = 0,
  unitPriceCents,
  quantity,
  periods = 6,
}) {
  const safeBudget = Math.max(0, Math.round(budgetCents));
  const safeCommitted = Math.max(0, Math.round(alreadyCommittedCents));
  const safeCap = Math.max(0, Math.round(maxPurchaseCents ?? safeBudget));
  const safeUnit = Math.max(100, Math.round(unitPriceCents));
  const safeQty = Math.max(1, Math.round(quantity));
  const orderCostCents = safeUnit * safeQty;
  const startingHeadroomCents = Math.max(0, safeBudget - safeCommitted);

  let remainingCents = startingHeadroomCents;
  let affordableOrders = 0;
  let exhaustionOrder = null;
  const steps = [];

  for (let orderNum = 1; orderNum <= periods; orderNum++) {
    const reasons = [];
    if (safeQty > maxQuantity) reasons.push('QUANTITY_NOT_ALLOWED');
    if (orderCostCents > safeCap) reasons.push('PURCHASE_LIMIT_EXCEEDED');
    if (orderCostCents > remainingCents) reasons.push('BUDGET_EXCEEDED');

    const allowed = reasons.length === 0;
    if (allowed) {
      remainingCents -= orderCostCents;
      affordableOrders++;
    } else if (exhaustionOrder === null) {
      exhaustionOrder = orderNum;
    }

    steps.push({
      orderNumber: orderNum,
      orderCostCents,
      allowed,
      reasons,
      remainingAfterCents: remainingCents,
      utilizationPct: safeBudget > 0 ? Math.min(100, Math.round(((safeBudget - remainingCents) / safeBudget) * 100)) : 100,
    });
  }

  return {
    orderCostCents,
    startingHeadroomCents,
    endingRemainingCents: remainingCents,
    affordableOrders,
    exhaustionOrder,
    steps,
  };
}
