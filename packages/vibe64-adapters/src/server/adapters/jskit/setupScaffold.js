import path from "node:path";

import {
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  shellScript
} from "@local/studio-terminal-core/server/shellScript";

const JSKIT_SCAFFOLD_ALLOWED_NON_SOURCE_ENTRIES = new Set([
  "node_modules"
]);

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
}

function scaffoldCommandPreview() {
  return `npx @jskit-ai/create-app "$JSKIT_APP_NAME" --target . --force --tenancy-mode ${shellQuote("none")} --title "$JSKIT_APP_TITLE" --initial-bundles none`;
}

function scaffoldScript() {
  return shellScript([
    "set -e",
    "set -x",
    scaffoldCommandPreview()
  ]);
}

async function checkJskitScaffold(targetRoot, context, toolkit) {
  const markers = {
    configPublic: await toolkit.targetConfigFileExists("public.js", { targetRoot }),
    lock: await toolkit.targetFileExists(".jskit/lock.json", { targetRoot }),
    packageJson: await toolkit.targetFileExists("package.json", { targetRoot })
  };

  if (markers.lock) {
    const lock = await toolkit.readTargetJson(".jskit/lock.json", { targetRoot });
    if (!lock.ok) {
      return hardStopCheck({
        id: "scaffold",
        label: "Seed JSKIT app",
        expected: ".jskit/lock.json is valid JSON.",
        observed: lock.error,
        explanation: "Malformed JSKIT metadata needs manual recovery before Studio can reason about the app."
      });
    }
    context.jskitLock = lock.value;
  }

  if (markers.packageJson && markers.lock && markers.configPublic) {
    return passCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "package.json, .jskit/lock.json, and config/public.js exist.",
      observed: "Minimal JSKIT scaffold markers are present.",
      explanation: "Studio can now use official JSKIT tooling for deeper checks."
    });
  }

  const nonGitEntries = (context.nonGitEntries || [])
    .filter((entry) => !JSKIT_SCAFFOLD_ALLOWED_NON_SOURCE_ENTRIES.has(entry));
  if (nonGitEntries.length) {
    const missingMarkers = Object.entries(markers)
      .filter(([, present]) => !present)
      .map(([name]) => name)
      .join(", ");
    return hardStopCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "Existing files are already a recognizable JSKIT scaffold.",
      observed: `Missing markers: ${missingMarkers}\nFiles: ${formatList(nonGitEntries)}`,
      explanation: "Studio will not run the JSKIT app generator over an existing non-JSKIT file tree."
    });
  }

  return passCheck({
    id: "scaffold",
    label: "Seed JSKIT app",
    expected: "Minimal JSKIT scaffold markers exist, or this empty target can be seeded by the first Vibe64 session.",
    observed: "No scaffold files are present yet.",
    explanation: "The seed workflow will ask the user which JSKIT modules to install and then create the app. Setup should only prepare Studio infrastructure."
  });
}

export {
  checkJskitScaffold,
  repoNameFromTargetRoot,
  scaffoldCommandPreview,
  scaffoldScript
};
