import { createHash } from 'node:crypto';

// Sort object keys recursively so a change in JSON serialization order does
// not invalidate a snapshot. Arrays preserve their original order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function sealDecision({ mandate, ...facts }) {
  // id and owner are the secret browser session identifier, not policy inputs.
  const { id, owner, ...rules } = mandate;
  const evidence = { schemaVersion: 1, mandate: rules, mandateSha256: digest(rules), ...facts };
  return { evidence, evidenceSha256: digest(evidence) };
}

export function verifyDecision(record) {
  if (!record.evidence && !record.evidenceSha256) return null;
  return Boolean(record.evidence?.mandate &&
    digest(record.evidence.mandate) === record.evidence.mandateSha256 &&
    digest(record.evidence) === record.evidenceSha256);
}
