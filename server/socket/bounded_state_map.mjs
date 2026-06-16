/**
 * @template T
 * @param {Map<string, T>} map
 * @param {(state: T) => boolean} isStale
 * @param {number} scanLimit
 * @param {(state: T) => void} [onEvict]
 * @returns {number}
 */
export function pruneStaleEntries(map, isStale, scanLimit, onEvict) {
  let checked = 0;
  let pruned = 0;
  for (const [key, state] of map) {
    if (checked >= scanLimit) break;
    checked += 1;
    if (!isStale(state)) break;
    onEvict?.(state);
    map.delete(key);
    pruned += 1;
  }
  return pruned;
}

/**
 * @template T
 * @param {Map<string, T>} map
 * @param {number} maxSize
 * @param {(state: T) => void} [onEvict]
 * @returns {number}
 */
export function capToMaxSize(map, maxSize, onEvict) {
  let pruned = 0;
  while (map.size > maxSize) {
    const oldest = map.entries().next();
    if (oldest.done) break;
    onEvict?.(oldest.value[1]);
    map.delete(oldest.value[0]);
    pruned += 1;
  }
  return pruned;
}

/**
 * @template T
 * @param {Map<string, T>} map
 * @param {string} key
 * @returns {T | undefined}
 */
export function touchExisting(map, key) {
  const existing = map.get(key);
  if (existing === undefined) return undefined;
  map.delete(key);
  map.set(key, existing);
  return existing;
}
