// The command spawner: the small process that starts the editor server's finite commands. commandSpawner.js starts it
// and explains why it exists; commandExecutor.js starts each command. This file only connects the two.
//
// It talks only through the IPC channel the editor created when it started it, which nothing else holds, and it ends
// when the editor goes: the channel's disconnect. Signals sent to the editor's whole process group (a terminal's
// Ctrl-C) or cgroup (a service manager's stop) do not end it, so the commands running while the editor stops are still
// reported until the editor exits. A message it does not know makes it say so on its stderr and exit, so the editor
// fails the commands it was running.

import { createCommandExecutor, describeMessage } from "./commandExecutor.js";

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {});
process.on("disconnect", () => process.exit(0));

// Messages are numbered as they are sent, and the channel writes them in order, so the last one written tells what is
// still in this process's memory. Each waiter waits for the messages sent before it asked.
let sent = 0;
let written = 0;
const waiters = [];
const receive = createCommandExecutor({
  send: (message) => {
    const number = ++sent;
    return process.send(message, () => {
      written = number;
      while (waiters.length > 0 && waiters[0].after <= written) waiters.shift().onWritten();
    });
  },
  written: () => written === sent,
  whenWritten: (onWritten) => {
    if (written === sent) onWritten();
    else waiters.push({ after: sent, onWritten });
  },
  refuse: (message) => {
    process.stderr.write(`Vibe64's command spawner refused a message it does not know (${describeMessage(message)}) and stops.\n`);
    process.exit(70);
  }
});
process.on("message", receive);
