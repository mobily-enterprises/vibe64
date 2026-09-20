// Runs inside Vibe64's managed execution scope. Only bytes cross this private
// socket: Claude Code is unmodified and owns its own authentication and history.
import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import net from "node:net";

const [socketPath, command, ...args] = process.argv.slice(2);
if (!socketPath || !command) throw new Error("Claude bridge requires a socket and command.");
process.umask(0o007);
let child;
let connected = false;
const server = net.createServer((socket) => {
  if (connected) return socket.destroy();
  connected = true;
  server.close();
  // Claude's own Git probes leave stdin open. Identify Claude itself as their
  // parent; exec preserves this PID while keeping Bash tool pipelines intact.
  child = spawn("/bin/sh", ["-c",
    'export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$; exec "$@"',
    "vibe64-claude", command, ...args
  ], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  child.on("error", () => socket.destroy());
  child.stdin.on("error", () => socket.destroy());
  child.stdout.pipe(socket);
  socket.pipe(child.stdin);
  // Losing the observing client must stop the entire managed process tree.
  socket.on("error", () => {});
  socket.on("close", () => {
    if (process.platform !== "win32") process.kill(-process.pid, "SIGTERM");
    else child.kill();
  });
  child.on("close", (code) => {
    socket.end();
    process.exitCode = code || 0;
  });
});
server.on("error", (error) => { throw error; });
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o600);
});
setTimeout(() => {
  if (!connected) process.exit(1);
}, 30_000).unref();
