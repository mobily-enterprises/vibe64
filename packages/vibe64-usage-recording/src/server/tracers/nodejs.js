// Placeholder until the Node.js recorder lands; see tracers/index.js.
export default Object.freeze({
  runtime: "nodejs",
  label: "Node.js",
  prepare() {
    return { available: false, reason: "Node.js recording is being added" };
  }
});
