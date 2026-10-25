// Identifier shapes the session package accepts in more than one place.
// A browser-issued key: a tab origin or a renewal operation key.
const BROWSER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const UUID_V4_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export { BROWSER_KEY_PATTERN, UUID_V4_PATTERN };
