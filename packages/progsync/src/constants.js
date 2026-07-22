const PROGRAM_DIRECTORY = "program";
const PROGRAM_INDEX_DIRECTORY = ".program/index";
const DEFAULT_GIT_BASE = "HEAD";
const PROGSYNC_STATE_REF = "refs/worktree/progsync/state";
const PROGSYNC_STATE_SCHEMA_VERSION = 2;

const TARGETS = Object.freeze({
  ".html": Object.freeze({
    kind: "html",
    prompt: "html.txt"
  }),
  ".js": Object.freeze({
    kind: "javascript",
    prompt: "javascript.txt"
  }),
  ".mjs": Object.freeze({
    kind: "javascript",
    prompt: "javascript.txt"
  }),
  ".vue": Object.freeze({
    kind: "vue",
    prompt: "vue.txt"
  })
});

const SYNCHRONIZATION_MODES = Object.freeze([
  "CREATE_PROGRAM",
  "CREATE_IMPLEMENTATION",
  "PROGRAM_TO_IMPLEMENTATION",
  "IMPLEMENTATION_TO_PROGRAM",
  "RECONCILE_BOTH",
  "NO_CHANGE"
]);

export {
  DEFAULT_GIT_BASE,
  PROGRAM_DIRECTORY,
  PROGRAM_INDEX_DIRECTORY,
  PROGSYNC_STATE_REF,
  PROGSYNC_STATE_SCHEMA_VERSION,
  SYNCHRONIZATION_MODES,
  TARGETS
};
