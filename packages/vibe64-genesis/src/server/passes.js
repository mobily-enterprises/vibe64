/**
 * One pass in Genesis's list (`genesis inspect passes --json`, contract genesis.passes.v1), as
 * Vibe64 reads it. Genesis's entries also carry skill and stackGuidance, which its own prompt uses.
 * @typedef {object} GenesisPass
 * @property {string} id the Genesis prompt task the pass runs
 * @property {string} title its name, as the person reads it
 * @property {string} description one line on what it does
 * @property {{ when: string, hint: string }} recommend when Genesis suggests running it:
 *   "after-change", "first-version" or "periodic", and a line saying so. Vibe64 decides when to
 *   suggest it.
 * @property {string} request the pass's default request, never empty: Run sends it as the person's
 *   message, and Genesis treats it as it treats no request
 * @property {string | null} lastRun when the pass last completed in the project, from Genesis's
 *   committed record (a UTC ISO time), or null when it never has
 */

/**
 * ADAPTER, until Genesis's pass list is released. Genesis owns each pass: its prompt, title,
 * description, recommendation hint and the record of its last completed run, and lists them with
 * `genesis inspect passes --json` (inspectPasses({ projectRoot }) in genesis-compiler). Until that
 * release is pinned, this copy stands in for the list in the same shape, with no run recorded.
 * Once it is, listGenesisPasses returns Genesis's list for the project and this copy goes.
 * @type {readonly GenesisPass[]}
 */
const GENESIS_PASSES_ADAPTER = Object.freeze([
  {
    id: "deslop",
    title: "Deslop",
    description: "Simplify the code and remove repetition without changing what the app does.",
    recommend: { when: "after-change", hint: "after each saved change" },
    request: "Deslop your own changes for the current task."
  },
  {
    id: "ui-pass",
    title: "UI pass",
    description: "Bring every screen in line with the project's UI guidance, on phones and wide screens.",
    recommend: { when: "after-change", hint: "after a change to the screens" },
    request: "UI pass your own changes for the current task."
  },
  {
    id: "identity-pass",
    title: "Visual identity",
    description: "Give the app a complete designed look: theme, artwork, logo and loading screen.",
    recommend: { when: "first-version", hint: "once a first working version exists" },
    request: "Give the whole app its visual identity."
  },
  {
    id: "quality-pass",
    title: "Quality pass",
    description: "Check the app end to end and fix what a careful reviewer would flag.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work" },
    request: "Quality pass the whole app."
  },
  {
    id: "data-pass",
    title: "Data pass",
    description: "Keep each fact in one place and check that data takes its real paths.",
    recommend: { when: "periodic", hint: "after a stretch of changes, about every few weeks of active work" },
    request: "Data pass the whole app."
  }
].map((pass) => Object.freeze({ ...pass, recommend: Object.freeze(pass.recommend), lastRun: null })));

/**
 * The passes Genesis offers, in Genesis's order: improvement tasks a person runs on the whole app,
 * each in its own Senior turn. Genesis's list takes the project's source ({ projectRoot }) and
 * reports that project's lastRun, failing with PASS_RECORD_INVALID when its record is malformed;
 * the adapter has no runs to report.
 * @returns {Promise<readonly GenesisPass[]>}
 */
async function listGenesisPasses() {
  return GENESIS_PASSES_ADAPTER;
}

export {
  GENESIS_PASSES_ADAPTER,
  listGenesisPasses
};
