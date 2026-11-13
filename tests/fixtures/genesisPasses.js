// Genesis's pass list (genesis.passes.v1) as genesis-compiler lists it for a project where no pass
// has run, for the server, client and browser tests that stand in for Genesis.
// genesisPasses.integration.test.js checks it against the installed Genesis.
const GENESIS_PASSES = Object.freeze([
  {
    id: "deslop",
    title: "Deslop",
    description: "Simplifies changes without changing what they do: no repeated helpers, unclear code or code that ignores the project's patterns.",
    recommend: { when: "after-change", hint: "after each saved change" },
    request: "Deslop your own changes for the current task."
  },
  {
    id: "ui-pass",
    title: "UI pass",
    description: "Makes screens follow the design rules of the project's technology exactly, without changing what they do.",
    recommend: { when: "after-change", hint: "after a change to the screens" },
    request: "UI pass your own changes for the current task."
  },
  {
    id: "identity-pass",
    title: "Visual identity",
    description: "Gives the app a look of its own: one seed colour, artwork drawn for its content, a logo, empty states, a loading screen and a sign-in page.",
    recommend: { when: "first-version", hint: "once a first working version exists" },
    request: "Give the whole app its visual identity."
  },
  {
    id: "quality-pass",
    title: "Quality pass",
    description: "Makes the app hold up in use: loading, empty and error states, edge cases, refusals the person understands and accessibility, checked by using it.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work" },
    request: "Quality pass the whole app."
  },
  {
    id: "data-pass",
    title: "Data pass",
    description: "Makes data hold up at real sizes: queries that grow with the rows read, enforced constraints, safe migrations and indexes for real filters, tested at realistic sizes.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work" },
    request: "Data pass the whole app."
  }
].map((pass) => Object.freeze({ ...pass, recommend: Object.freeze(pass.recommend), skill: `genesis-${pass.id}`, stackGuidance: false, lastRun: null })));

export { GENESIS_PASSES };
