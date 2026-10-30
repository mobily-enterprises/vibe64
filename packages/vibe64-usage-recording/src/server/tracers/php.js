// Placeholder until the PHP recorder lands; see tracers/index.js.
export default Object.freeze({
  runtime: "php",
  label: "PHP",
  prepare() {
    return { available: false, reason: "PHP recording is being added" };
  }
});
