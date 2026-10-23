import { notImplemented } from "../../notImplemented.js";

const githubReleasesDestination = Object.freeze({
  id: "github-releases",
  label: "GitHub Releases",
  packers: Object.freeze(["npm", "python-dist", "capacitor"]),
  channels: Object.freeze(["draft", "prerelease", "latest"]),
  credentials: Object.freeze([]),
  implemented: false,
  dryRun: notImplemented("destination", "github-releases", "dry-run"),
  upload: notImplemented("destination", "github-releases", "upload"),
  readBack: notImplemented("destination", "github-releases", "read back")
});

export { githubReleasesDestination };
