// Runs inside Vibe64's managed execution scope. Only bytes cross this private
// socket: the native process keeps its protocol, authentication and history.
import { spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import net from "node:net";

// An empty umask argument keeps the one this process inherited.
const [socketPath, umask, command, ...args] = process.argv.slice(2);
if (!socketPath || !command) throw new Error("The stdio bridge requires a socket and command.");
if (umask) process.umask(Number.parseInt(umask, 8));
let child;
let connected = false;
const server = net.createServer({ allowHalfOpen: true }, (socket) => {
  if (connected) return socket.destroy();
  connected = true;
  server.close();
  // Claude's own Git probes leave stdin open. Identify Claude itself as their
  // parent; exec preserves this PID while keeping Bash tool pipelines intact.
  child = spawn("/bin/sh", ["-c",
    'export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$; exec "$@"',
    "vibe64-stdio", command, ...args
  ], { stdio: ["pipe", "pipe", "inherit"], env: process.env });
  child.on("error", () => socket.destroy());
  child.stdin.on("error", () => socket.destroy());
  let outputEnded = false;
  child.stdout.once("end", () => {
    outputEnded = true;
  });
  child.stdout.pipe(socket);
  socket.pipe(child.stdin);
  // Input EOF may precede the reply. Scope cleanup still belongs to the host;
  // a fully broken stream can terminate the bridge's owned process group early.
  socket.on("error", () => {});
  socket.on("close", () => {
    if (outputEnded || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform !== "win32") process.kill(-process.pid, "SIGTERM");
    else child.kill();
  });
  child.on("close", (code, signal) => {
    socket.end();
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
  // A stop signals this bridge's whole process group. The bridge ends after its child, which it reaps, and then as
  // the signal asked: an orphan would wait for init to reap it, and the stop reads the group as running until then.
  // The child's input ends here as it did when the bridge died at once, so a child that no signal reached, the
  // bridge's alone, still ends; one that outlasts the stop's grace ends with the bridge at its SIGKILL.
  process.on("SIGTERM", () => {
    const end = () => {
      process.removeAllListeners("SIGTERM");
      process.kill(process.pid, "SIGTERM");
    };
    if (child.exitCode !== null || child.signalCode !== null) return end();
    socket.unpipe(child.stdin);
    child.stdin.end();
    child.once("exit", end);
  });
});
server.on("error", (error) => {
  throw error;
});
// Set the socket's mode synchronously: the listening callback runs before any
// connection is handled, and the first connection closes the server, which
// removes the socket. A chmod queued behind other thread-pool work could run
// after that, fail and end the bridge with the client's first bytes unread
// (the client then reads ECONNRESET).
server.listen(socketPath, () => chmodSync(socketPath, 0o600));
setTimeout(() => {
  if (!connected) process.exit(1);
}, 30_000).unref();
