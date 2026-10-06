// Runs inside Vibe64's managed execution scope. Only bytes cross this private
// socket: the native process keeps its protocol, authentication and history.
import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import net from "node:net";

const [socketPath, command, ...args] = process.argv.slice(2);
if (!socketPath || !command) throw new Error("The stdio bridge requires a socket and command.");
process.umask(0o007);
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
  child.stdout.once("end", () => { outputEnded = true; });
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
});
server.on("error", (error) => { throw error; });
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o600);
});
setTimeout(() => {
  if (!connected) process.exit(1);
}, 30_000).unref();
