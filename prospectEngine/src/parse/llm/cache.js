const store = new Map();

export function cacheKey({
  promptKey,
  archetype,
  contentHash,
}) {
  return [promptKey, archetype, contentHash]
    .filter(Boolean)
    .join("::");
}

export function getCached(key) {
  return store.has(key)
    ? store.get(key)
    : null;
}

export function setCached(key, value) {
  store.set(key, value);
}

export function clearCache() {
  store.clear();
}
