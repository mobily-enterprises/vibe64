// The command spawner: the small process that starts the editor server's finite commands. commandSpawner.js starts it
// and explains why it exists; commandExecutor.js starts each command. This file only connects the two.
//
// It talks only through what the editor created when it started it, which nothing else holds: the IPC channel, and a
// pipe (fd 4) it writes each started command's id and pid to. Node opens both close-on-exec, so no command inherits
// them. It ends when the editor goes: the channel's disconnect. Signals sent to the editor's whole process group (a
// terminal's Ctrl-C) or cgroup (a service manager's stop) do not end it, so the commands running while the editor
// stops are still reported until the editor exits. A message it does not know makes it say so on its stderr and exit,
// so the editor fails the commands it was running.

import { writeSync } from "node:fs";

import { START_RECORD_BYTES, createCommandExecutor, describeMessage } from "./commandExecutor.js";

const START_RECORDS_FD = 4;

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) process.on(signal, () => {});
process.on("disconnect", () => process.exit(0));

const receive = createCommandExecutor({
  send: (message, onWritten) => process.send(message, onWritten),
  refuse: (message) => {
    process.stderr.write(`Vibe64's command spawner refused a message it does not know (${describeMessage(message)}) and stops.\n`);
    process.exit(70);
  },
  // A blocking write of one small record, which the executor's cap keeps from ever waiting.
  recordStart: (id, pid) => {
    const record = Buffer.alloc(START_RECORD_BYTES);
    record.writeBigUInt64LE(BigInt(id), 0);
    record.writeUInt32LE(pid, 8);
    const written = writeSync(START_RECORDS_FD, record);
    if (written !== START_RECORD_BYTES) throw new Error(`Vibe64's command spawner wrote ${written} bytes of a start record.`);
  }
});
process.on("message", receive);
