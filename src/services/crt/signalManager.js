const seen = new Map();

const maxEntries = Number(process.env.CRT_MAX_SEEN_SIGNALS || 5000);

export function isNewSignal(id) {
  if (!id) return false;
  if (seen.has(id)) return false;
  seen.set(id, Date.now());
  trim();
  return true;
}

export function clearSignals() {
  seen.clear();
}

function trim() {
  while (seen.size > maxEntries) {
    const first = seen.keys().next().value;
    if (first === undefined) break;
    seen.delete(first);
  }
}
