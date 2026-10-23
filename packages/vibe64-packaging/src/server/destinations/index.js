// Destinations receive the exact Stage 1 artifacts. Each entry declares the
// credentials it needs ({ id, label, delivery: "file" | "stdin" }) and implements
// dryRun, upload (Stage 2) and readBack (Stage 3, `{ published, checksum }`).
import { publishError } from "../errors.js";
import { androidSideloadDestination } from "./androidSideload/index.js";
import { githubReleasesDestination } from "./githubReleases/index.js";
import { npmDestination } from "./npm/index.js";
import { pypiDestination } from "./pypi/index.js";

const VIBE64_DESTINATIONS = Object.freeze(Object.fromEntries(
  [npmDestination, pypiDestination, githubReleasesDestination, androidSideloadDestination]
    .map((destination) => [destination.id, destination])
));

function vibe64Destination(id) {
  const destination = VIBE64_DESTINATIONS[id];
  if (!destination) throw publishError("VIBE64_PUBLISH_DESTINATION_UNKNOWN", `Unknown destination ${id}.`);
  return destination;
}

export { VIBE64_DESTINATIONS, vibe64Destination };
