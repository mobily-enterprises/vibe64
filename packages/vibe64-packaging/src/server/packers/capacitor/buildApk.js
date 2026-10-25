// The Stage 1 recipe of a `capacitor` package: generate the shell in a throwaway
// folder next to the exported source, install the pinned Capacitor runtime and
// the app's plugins there, let Capacitor create its Android project, patch it,
// draw the icons, and run Gradle once (`--no-daemon`, so no build process
// outlives the build). The result is one unsigned APK; signing is Stage 2.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { publishError } from "../../errors.js";
import { pathWithin } from "../../paths.js";
import { readSourceVersion } from "../../release/prepareChange.js";
import { describeAndroidSdk } from "../../toolchains/androidSdk.js";
import { describeJdk } from "../../toolchains/jdk.js";
import { webRoot } from "../webBundle/index.js";
import { generateShell, writeShell } from "./generateShell.js";
import { iconProblems, iconStep } from "./icons.js";

const SHELL_PATCH = fileURLToPath(new URL("./shellPatch.js", import.meta.url));

async function requireToolchains(toolchains = {}) {
  const jdk = await describeJdk({ javaHome: toolchains.javaHome });
  const sdk = await describeAndroidSdk({ androidHome: toolchains.androidHome });
  if (!jdk.ok || !sdk.ok) {
    throw publishError("VIBE64_PUBLISH_TOOLCHAIN_MISSING", [jdk.ok ? "" : jdk.message, sdk.ok ? "" : sdk.message].filter(Boolean).join(" "), {
      java: jdk.ok,
      androidSdk: sdk.ok,
      missing: sdk.missing || []
    });
  }
  return { javaHome: jdk.javaHome, androidHome: sdk.androidHome };
}

// context: { sourceRoot, entry, content (its web-bundle entry), contentArtifacts
// (that package's Stage 1 result), version, versionCode, toolchains: { javaHome,
// androidHome }, cacheDirectory }.
async function capacitorRecipe({
  sourceRoot,
  entry,
  content,
  contentArtifacts,
  version = null,
  versionCode,
  toolchains,
  cacheDirectory = ""
} = {}) {
  if (typeof sourceRoot !== "string" || !path.isAbsolute(sourceRoot)) {
    throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The capacitor packer needs the exported source folder.");
  }
  if (!entry.platforms.includes("android")) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Package ${entry.id} builds no Android app.`);
  if (!contentArtifacts) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `Package ${entry.id} needs its ${entry.content} content built first.`);
  const { javaHome, androidHome } = await requireToolchains(toolchains);
  const icon = path.join(sourceRoot, entry.application.icon);
  if (!pathWithin(sourceRoot, icon, { allowRoot: false })) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "The app icon must be inside the project.");
  const iconBytes = await readFile(icon).catch(() => null);
  if (!iconBytes) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `The app icon ${entry.application.icon} is not in the saved commit.`);
  const problems = iconProblems(iconBytes);
  if (problems.length) throw publishError("VIBE64_PUBLISH_BUILD_INVALID", problems.join(" "));

  const shellRoot = path.join(path.dirname(sourceRoot), "shell");
  const appVersion = version || await readSourceVersion({ projectRoot: sourceRoot, entry });
  const { files } = await generateShell({ sourceRoot, entry, content, version: appVersion, versionCode });
  await writeShell({ shellRoot, files, webRoot: webRoot(contentArtifacts).directory, iconFile: icon });
  const android = path.join(shellRoot, "android");
  const node = process.execPath;
  const environment = [
    { name: "JAVA_HOME", value: javaHome },
    { name: "ANDROID_HOME", value: androidHome },
    { name: "GRADLE_OPTS", value: "-Dorg.gradle.daemon=false -Dorg.gradle.welcome=never" }
  ];
  if (cacheDirectory) environment.push({ name: "GRADLE_USER_HOME", value: path.join(cacheDirectory, "gradle") });
  const json = JSON.parse(files["vibe64-shell.json"]);
  return {
    packageName: entry.application.id,
    version: appVersion,
    versionCode,
    steps: [
      {
        label: "Install the app shell",
        argv: ["npm", "install", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=warn"],
        cwd: shellRoot
      },
      {
        label: "Create the Android project",
        argv: [node, path.join(shellRoot, "node_modules", "@capacitor", "cli", "bin", "capacitor"), "add", "android"],
        cwd: shellRoot
      },
      { label: "Apply the app's settings", argv: [node, SHELL_PATCH, "apply", shellRoot], cwd: shellRoot },
      iconStep({ javaHome, icon: path.join(shellRoot, "icon.png"), resourceRoot: path.join(android, "app", "src", "main", "res"), cwd: shellRoot }),
      {
        label: "Build the Android app",
        argv: [path.join(android, "gradlew"), "--no-daemon", "--console=plain", "--quiet", "assembleRelease"],
        cwd: android
      },
      { label: "Collect the unsigned APK", argv: [node, SHELL_PATCH, "collect", shellRoot], cwd: shellRoot }
    ],
    outputs: [path.join(shellRoot, "out", json.output)],
    environment,
    allowedRoots: [shellRoot]
  };
}

export { capacitorRecipe, requireToolchains };
