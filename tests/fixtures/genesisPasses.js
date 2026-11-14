// Genesis's pass list (genesis.passes.v1) as genesis-compiler lists it for a project where no pass
// has completed and whose own Genesis runs them all, for the server, client and browser tests that
// stand in for Genesis: each pass offers the whole app, with the pass's own request, and the whole
// app deeply, sized in the project's own files and lines; and the Master pass, which runs them deeply
// in its order. genesisPasses.integration.test.js checks them against the installed Genesis, sizes aside.
const SIZE = Object.freeze({ files: 212, lines: 18450 });
const sized = (label) => `${label} (212 files, 18,450 lines)`;
const GENESIS_PASSES = Object.freeze([
  {
    id: "deslop",
    title: "Deslop",
    description: "Simplifies the app's code without changing what it does: no repeated helpers, unclear code or code that ignores the project's patterns.",
    recommend: { when: "after-change", hint: "after each saved change" },
    request: "Deslop the whole app."
  },
  {
    id: "ui-pass",
    title: "UI pass",
    description: "Makes screens follow the design rules of the project's technology exactly, without changing what they do.",
    recommend: { when: "after-change", hint: "after a change to the screens" },
    request: "UI pass the whole app."
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
  },
  {
    id: "security-pass",
    title: "Security pass",
    description: "Makes the app refuse what it should: permission checked on every action, guarded sign-in, inputs checked at the boundary, no exposed secrets and safe production settings, each fix proved by trying the attack.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work, and before a first release" },
    request: "Security pass the whole app."
  },
  {
    id: "ux-pass",
    title: "User experience pass",
    description: "Makes the main things people do short and clear: fewer steps and decisions, easy to find, plain words, good defaults and mistakes easy to undo, each task walked before and after.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work, and before new people start using the app" },
    request: "User experience pass the whole app."
  },
  {
    id: "speed-pass",
    title: "Speed pass",
    description: "Makes the app and its tests fast: tests prepared once and run in parallel, screens that load only what they need, and requests that do each piece of work once, each wait measured before and after with nothing weakened.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work, and whenever tests, pages or saves feel slow" },
    request: "Speed pass the whole app."
  }
].map((pass) => Object.freeze({
  ...pass,
  recommend: Object.freeze(pass.recommend),
  skill: `genesis-${pass.id}`,
  stackGuidance: false,
  lastRun: null,
  unavailable: null,
  runs: Object.freeze([
    Object.freeze({ id: "whole", label: "Whole app", request: pass.request }),
    Object.freeze({ id: "deep", label: sized("Deep"), request: pass.request.replace(/\.$/u, " deeply."), ...SIZE })
  ])
})));

const GENESIS_MASTER_PASS = Object.freeze({
  id: "master-pass",
  title: "Master pass",
  description: "Runs every pass deeply, one after another, or the passes you choose, committing and running the whole test suite after each.",
  request: "Master pass the whole app.",
  skill: "genesis-master-pass",
  lastRun: null,
  lastPasses: null,
  unavailable: null,
  passes: Object.freeze(["security-pass", "data-pass", "quality-pass", "speed-pass", "ux-pass", "identity-pass", "ui-pass", "deslop"]),
  runs: Object.freeze([Object.freeze({
    id: "whole",
    label: sized("Whole app"),
    request: "Master pass the whole app.",
    selectedRequest: "Master pass ({passes}) the whole app.",
    ...SIZE
  })])
});

export { GENESIS_MASTER_PASS, GENESIS_PASSES };
