export class SerialTaskQueue {
  constructor() {
    this.pending = Promise.resolve();
  }

  /**
   * @template T
   * @param {() => Promise<T> | T} task
   * @returns {Promise<T>}
   */
  runExclusive(task) {
    const run = this.pending.then(task, task);
    this.pending = run.then(
      function clearPending() {},
      function clearPendingAfterError() {},
    );
    return run;
  }
}

export default SerialTaskQueue;
