// The types of Genesis results this boundary returns, which its readers share.

/**
 * One pass in Genesis's list (contract genesis.passes.v1). Genesis's entries also carry skill and stackGuidance, which
 * its own prompt uses.
 * @typedef {object} GenesisPass
 * @property {string} id the Genesis prompt task the pass runs
 * @property {string} title its name, as the person reads it
 * @property {string} description one line on what it does
 * @property {{ when: string, hint: string }} recommend when Genesis advises running it: "after-change", "first-version"
 *   or "periodic", and a line saying so; Vibe64 decides when to suggest it
 * @property {string} request the pass's own request, over the whole app
 * @property {string | null} lastRun when it last completed, from Genesis's committed record (a UTC ISO time), or null
 * @property {string | null} unavailable why the Genesis serving the project cannot run it, or null
 * @property {{ id: string, label: string, request: string, files?: number, lines?: number }[]} runs the runs Genesis
 *   offers now ("whole", "since-last", and "deep" with the files and lines it reads, which its label shows), none while
 *   the pass is unavailable: Run sends a run's request verbatim, and Genesis records the pass only for these requests
 */

/**
 * The Master pass in Genesis's list: it runs `passes` (pass ids, in its order) deeply, one after another, and
 * `lastPasses` are those it ran when it last completed. Each of its `runs` ("whole", then "since-last" once one has
 * completed) carries `request`, for every pass, and `selectedRequest`, whose `{passes}` the chosen passes' titles
 * replace, comma-separated, with its size in `files`, `lines` and its label.
 * @typedef {{ id: string, title: string, description: string, request: string, lastRun: string | null,
 *   lastPasses: string[] | null, unavailable: string | null, passes: string[], runs: object[] }} GenesisMasterPass
 */

export {};
