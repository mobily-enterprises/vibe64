// Providers whose own OAuth client Vibe64 can register for a project. The
// server's registrar map in integrations.js holds one registrar per id.
const OAUTH_CLIENT_REGISTRATION_PROVIDERS = Object.freeze([
  "n8n",
  "amplitude",
  "atlassian",
  "confidence-exp",
  "confidence-flags",
  "sanity",
  "sentry",
  "granola",
  "hex",
  "heygen"
]);

export {
  OAUTH_CLIENT_REGISTRATION_PROVIDERS
};
