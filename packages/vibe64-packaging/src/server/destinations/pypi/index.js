import { notImplemented } from "../../notImplemented.js";

const pypiDestination = Object.freeze({
  id: "pypi",
  label: "PyPI",
  packers: Object.freeze(["python-dist"]),
  channels: Object.freeze([]),
  credentials: Object.freeze([]),
  implemented: false,
  dryRun: notImplemented("destination", "pypi", "dry-run"),
  upload: notImplemented("destination", "pypi", "upload"),
  readBack: notImplemented("destination", "pypi", "read back")
});

export { pypiDestination };
