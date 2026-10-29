// Local detached executions lead their own process groups, so they do not end
// when the server ends. This process holds those group IDs on a pipe from the
// server (`+<pgid>` starts holding one, `-<pgid>` releases it). When the server
// ends in any way, including a crash, kill -9, a closed terminal window or the
// forced shutdown, the pipe closes and every group still held is stopped:
// SIGTERM, then SIGKILL after the same grace an ordinary stop gives. The server
// closes the pipe itself once it holds no group, so this process ends with the
// last detached execution.
const TERM_GRACE_MS = 3_000;
const groups = new Set();
let pending = "";
let draining = false;

function signal(pgid, name) {
  try {
    process.kill(-pgid, name);
  } catch {
    // An ended group, or one already stopped, needs nothing more.
  }
}

function exists(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function drain() {
  if (draining) return;
  draining = true;
  for (const pgid of groups) signal(pgid, "SIGTERM");
  const deadline = Date.now() + TERM_GRACE_MS;
  while ([...groups].some(exists) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  for (const pgid of groups) signal(pgid, "SIGKILL");
  process.exit(0);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  pending += chunk;
  const lines = pending.split("\n");
  // A line cut short by the server's own end names no whole group.
  pending = lines.pop();
  for (const line of lines) {
    const match = /^([+-])([1-9]\d*)$/u.exec(line);
    if (!match) continue;
    if (match[1] === "+") groups.add(Number(match[2]));
    else groups.delete(Number(match[2]));
  }
});
process.stdin.on("end", drain);
process.stdin.on("error", drain);
