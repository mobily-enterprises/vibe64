// Whether a process the kernel still lists has ended: the one rule every check of a process or process group in
// Vibe64 and its tests uses (tests/server/processEndedRule.unit.test.js refuses a state compared with Z anywhere else).
//
// Linux lists a process under its thread group leader, and /proc/<pid>/stat shows the leader's own state. A leader
// whose own thread has ended while the process's other threads run (a main thread that called pthread_exit) shows as
// a zombie, Z, for as long as the process runs. Its num_threads (field 20) counts the threads not yet released, the
// leader's own among them until its parent reaps it, so a zombie has ended only when that count is 1. X (dead) has
// ended. ps shows no thread count, and on macOS, where Vibe64 reads ps, a process is a zombie only after its last
// thread.
//
// The functions use nothing but their arguments: the preview browser's worker program embeds their text.
// The rule sits in src/server, which the turn checkpoint's command may load
// (tests/server/gitTurnCheckpoint.unit.test.js); the privileged helper's managedExecution.js imports it from there.

/**
 * The fields after the command name in /proc/<pid>/stat, or null for text that is not one. Any state letter is
 * accepted (tracing stop is lower-case "t"); callers decide which states they trust.
 * @param {string} text
 */
function linuxProcessStat(text = "") {
  const value = String(text || "").trim();
  const commandEnd = value.lastIndexOf(")");
  if (commandEnd < 0) {
    return null;
  }
  const fields = value.slice(commandEnd + 1).trim().split(/\s+/u);
  const state = String(fields[0] || "");
  const startTimeTicks = String(fields[19] || "");
  if (!/^[A-Za-z]$/u.test(state) || !/^\d+$/u.test(startTimeTicks)) {
    return null;
  }
  return {
    flags: Number(fields[6]),
    groupId: Number(fields[2]),
    parentId: Number(fields[1]),
    startTimeTicks,
    state,
    threads: Number(fields[17])
  };
}

/**
 * Whether a process has ended, from its state letter and, where /proc gave it, its thread count: dead, or a zombie
 * with no thread left but its own. A zombie leader whose process still has other threads has not ended, and nothing
 * read proves nothing ended.
 * @param {{ state?: string, threads?: number } | null | undefined} entry
 */
function processEnded(entry) {
  const state = String(entry?.state || "");
  return state === "X" || (state === "Z" && !(Number(entry?.threads) > 1));
}

export { linuxProcessStat, processEnded };
