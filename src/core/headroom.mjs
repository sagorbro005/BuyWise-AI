import { categoryLabels } from './categories.mjs';

const RESERVED_STATES = ['reserved', 'creating', 'order_created', 'capture_pending', 'review_required'];

export function computeHeadroomSummary(mandate, spentCents = 0, reservedCents = 0, intents = []) {
  const budgetCents = mandate?.budgetCents ?? 0;
  const allocatedCents = spentCents + reservedCents;
  const availableCents = Math.max(0, budgetCents - allocatedCents);
  const overBudgetCents = Math.max(0, allocatedCents - budgetCents);

  const denominator = Math.max(budgetCents, allocatedCents);
  const rawSpentPct = denominator > 0 ? (spentCents / denominator) * 100 : 0;
  const rawReservedPct = denominator > 0 ? (reservedCents / denominator) * 100 : 0;

  const spentPct = Math.round(rawSpentPct * 10) / 10;
  const reservedPct = Math.min(Math.round(rawReservedPct * 10) / 10, Math.max(0, 100 - spentPct));
  const availablePct = denominator > 0 ? Math.max(0, Math.round((100 - spentPct - reservedPct) * 10) / 10) : 100;

  const utilizationPct = budgetCents > 0
    ? Math.min(100, Math.round((allocatedCents / budgetCents) * 100))
    : 0;

  let health = 'healthy';
  if (!mandate) health = 'unconfigured';
  else if (!mandate.active) health = 'inactive';
  else if (utilizationPct >= 90 || availableCents === 0) health = 'critical';
  else if (utilizationPct >= 65) health = 'warning';

  const catMap = new Map();
  const ensureCat = (id) => {
    if (!catMap.has(id)) {
      catMap.set(id, {
        category: id,
        label: categoryLabels[id] || id,
        capturedCents: 0,
        reservedCents: 0,
        unitsUsed: 0,
        unitLimit: mandate?.categoryLimits?.[id] ?? mandate?.maxQuantity ?? null,
        allowed: Array.isArray(mandate?.categories) ? mandate.categories.includes(id) : false,
      });
    }
    return catMap.get(id);
  };

  for (const id of mandate?.categories || []) {
    ensureCat(id);
  }

  for (const intent of intents) {
    const isCaptured = intent.status === 'captured';
    const isReserved = RESERVED_STATES.includes(intent.status);
    if (!isCaptured && !isReserved) continue;

    if (Array.isArray(intent.lines) && intent.lines.length > 0) {
      for (const line of intent.lines) {
        const prod = line.product || {};
        const catId = prod.category || 'other';
        const entry = ensureCat(catId);
        const qty = Number(line.quantity || 0);
        const lineCents = ((prod.unitPriceCents ?? 0) + (prod.shippingCents ?? 0) + (prod.taxCents ?? 0)) * qty;
        if (isCaptured) entry.capturedCents += lineCents;
        else entry.reservedCents += lineCents;
        entry.unitsUsed += qty;
      }
    } else {
      const catId = intent.quote?.category || 'other';
      const entry = ensureCat(catId);
      if (isCaptured) entry.capturedCents += intent.totalCents ?? 0;
      else entry.reservedCents += intent.totalCents ?? 0;
      entry.unitsUsed += intent.quantity ?? 0;
    }
  }

  const categories = Array.from(catMap.values()).map((c) => {
    const totalCatCents = c.capturedCents + c.reservedCents;
    const sharePct = budgetCents > 0 ? Math.min(100, Math.round((totalCatCents / budgetCents) * 100)) : 0;
    return { ...c, totalCents: totalCatCents, sharePct };
  });

  return {
    budgetCents,
    spentCents,
    reservedCents,
    availableCents,
    overBudgetCents,
    spentPct,
    reservedPct,
    availablePct,
    utilizationPct,
    health,
    categories,
  };
}
