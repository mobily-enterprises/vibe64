// Identifier shapes the session package accepts in more than one place.
// A browser-issued key: a tab origin or a renewal operation key.
const BROWSER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

export { BROWSER_KEY_PATTERN };
