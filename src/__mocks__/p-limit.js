/**
 * Mock for p-limit ESM module
 * p-limit is used for concurrency control in batch processing
 */
const pLimit = (concurrency) => {
  // Return a simple wrapper that just executes the function
  return (fn) => fn();
};

// Named export
module.exports = pLimit;
module.exports.default = pLimit;
