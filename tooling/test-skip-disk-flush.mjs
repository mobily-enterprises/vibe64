// Loaded into every server test process, and each Node child it starts,
// beside the host path guard (tooling/run-targeted-tests.mjs and
// tooling/run-server-tests.mjs). A durable write flushes its file and folder to
// the disk (fsync, fdatasync) so that it survives a power cut. Nothing a test
// writes has to, so the flush only makes the test wait for the disk: on a test
// host whose disk other runs share, a flush took 10 ms at the median and up to
// 1.8 s, and the flushes were most of a session test's time (2026-11-26: one
// run of claudeStreamJson.unit.test.js spent 474 s in 11,859 flushes over its
// 518 s). Here a flush checks its descriptor with fstat, which refuses a closed
// file or a bad descriptor (EBADF) as the flush would, and returns without
// waiting for the disk. Every flush call still happens, so a test proving a
// write durable (tests/server/durableWriteTrace.js) still sees each one in order.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const probe = await fs.promises.open(new URL(import.meta.url), "r");
const handlePrototype = Object.getPrototypeOf(probe);
await probe.close();

handlePrototype.sync = async function syncWithoutDiskFlush() {
  await this.stat();
};
handlePrototype.datasync = async function datasyncWithoutDiskFlush() {
  await this.stat();
};
fs.fsync = function fsyncWithoutDiskFlush(descriptor, callback) {
  fs.fstat(descriptor, (error) => callback(error));
};
fs.fdatasync = function fdatasyncWithoutDiskFlush(descriptor, callback) {
  fs.fstat(descriptor, (error) => callback(error));
};
fs.fsyncSync = function fsyncSyncWithoutDiskFlush(descriptor) {
  fs.fstatSync(descriptor);
};
fs.fdatasyncSync = function fdatasyncSyncWithoutDiskFlush(descriptor) {
  fs.fstatSync(descriptor);
};
syncBuiltinESMExports();
