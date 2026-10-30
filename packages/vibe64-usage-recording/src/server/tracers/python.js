// Placeholder until the Python recorder lands; see tracers/index.js.
export default Object.freeze({
  runtime: "python",
  label: "Python",
  prepare() {
    return { available: false, reason: "Python recording is being added" };
  }
});
