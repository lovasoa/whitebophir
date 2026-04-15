import observability from "./observability.js";

const {
  LogfmtLogRecordExporter,
  __test,
  createRequestId,
  formatReadableLogRecord,
  logger,
  metrics,
  shutdownObservability,
  tracing,
} = observability;

export {
  LogfmtLogRecordExporter,
  __test,
  createRequestId,
  formatReadableLogRecord,
  logger,
  metrics,
  shutdownObservability,
  tracing,
};

export default observability;
