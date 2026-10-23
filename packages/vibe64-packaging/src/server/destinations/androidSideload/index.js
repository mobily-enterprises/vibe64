import { notImplemented } from "../../notImplemented.js";

const androidSideloadDestination = Object.freeze({
  id: "android-sideload",
  label: "Android: install on my phone",
  packers: Object.freeze(["capacitor"]),
  channels: Object.freeze([]),
  credentials: Object.freeze([]),
  implemented: false,
  dryRun: notImplemented("destination", "android-sideload", "dry-run"),
  upload: notImplemented("destination", "android-sideload", "sign"),
  readBack: notImplemented("destination", "android-sideload", "read back")
});

export { androidSideloadDestination };
