/** Head snippets opt in before board boot; collection is otherwise idle. */
export function performanceMetricsEnabled() {
  return (
    typeof document !== "undefined" &&
    document.documentElement?.dataset?.wboPerformance === "true"
  );
}

/** @param {string} name */
export function markPerformance(name) {
  if (!performanceMetricsEnabled()) return;
  try {
    performance.clearMarks(name);
    performance.mark(name);
  } catch {
    // Telemetry must never interrupt the application on unsupported browsers.
  }
}

/** Retain only the latest sample per name. Clearing the timeline does not clear
 * active PerformanceObservers' queues; buffered observers get the latest sample.
 * @param {string} name @param {PerformanceMeasureOptions} options */
export function measurePerformance(name, options) {
  if (!performanceMetricsEnabled()) return;
  try {
    performance.clearMeasures(name);
    performance.measure(name, options);
  } catch {
    // Includes unsupported User Timing options and uncloneable detail values.
  }
}
