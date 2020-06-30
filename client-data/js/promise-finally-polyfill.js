/**
 * This polyfill resolves Promise.finally problem for old browsers. For example iOS Safari less than 11.5
 * */
(function () {

  // Get a handle on the global object
  let globalObject;
  if (typeof global !== 'undefined') {
    globalObject = global;
  } else if (typeof window !== 'undefined' && window.document) {
    globalObject = window;
  }

  // check if the implementation is available
  if (typeof Promise.prototype['finally'] === 'function') {
    return;
  }

  // implementation
  globalObject.Promise.prototype['finally'] = function (callback) {
    const constructor = this.constructor;
    return this.then(function (value) {
      return constructor.resolve(callback()).then(function () {
        return value;
      });
    }, function (reason) {
      return constructor.resolve(callback()).then(function () {
        throw reason;
      });
    });
  };
}());
