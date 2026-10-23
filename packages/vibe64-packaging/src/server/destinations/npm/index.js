import { notImplemented } from "../../notImplemented.js";

const npmDestination = Object.freeze({
  id: "npm",
  label: "npm",
  packers: Object.freeze(["npm"]),
  channels: Object.freeze(["latest", "next"]),
  credentials: Object.freeze([]),
  implemented: false,
  dryRun: notImplemented("destination", "npm", "dry-run"),
  upload: notImplemented("destination", "npm", "upload"),
  readBack: notImplemented("destination", "npm", "read back")
});

export { npmDestination };
