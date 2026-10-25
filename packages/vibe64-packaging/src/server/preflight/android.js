// Preflight for Android app packages. gatherAndroidFacts reads what the checks
// need from the saved source and the toolchains; the checks stay pure.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { iconProblems } from "../packers/capacitor/icons.js";
import { nativePlugins, readContentDependencies } from "../packers/capacitor/generateShell.js";
import { ANDROID_PERMISSIONS } from "../packers/capacitor/permissions.js";
import { CAPACITOR_SHELL_TEMPLATE } from "../packers/capacitor/shellTemplate/index.js";
import { describeAndroidSdk } from "../toolchains/androidSdk.js";
import { describeJdk } from "../toolchains/jdk.js";
import { VIBE64_PREFLIGHT_CHECKS, definePreflightCheck } from "./index.js";

const REQUIRED_TARGET_SDK = 36;

function major(version) {
  return Number(String(version || "").split(".")[0]);
}

// facts.android: { packages: [{ id, targetSdk, icon: [problem], permissions:
// [problem], plugins: [problem] }], toolchain: { java, androidSdk },
// developerVerification: "registered" | null }
async function gatherAndroidFacts({ sourceRoot, packaging, packageIds = null, toolchains = {}, developerVerification = null } = {}) {
  const apps = (packaging?.packages || []).filter((entry) => entry.packer === "capacitor" && (!packageIds || packageIds.includes(entry.id)));
  if (!apps.length) return null;
  const packages = [];
  for (const entry of apps) {
    const iconBytes = await readFile(path.join(sourceRoot, entry.application.icon)).catch(() => null);
    const content = packaging.packages.find((candidate) => candidate.id === entry.content);
    const found = content ? nativePlugins(await readContentDependencies({ sourceRoot, content })) : { problems: [{ message: `Content ${entry.content} is missing.` }], core: null };
    const plugins = found.problems.map(({ message }) => message);
    if (found.core && major(found.core) !== major(CAPACITOR_SHELL_TEMPLATE.capacitor)) {
      plugins.push(`The app uses @capacitor/core ${found.core}; Vibe64 builds with Capacitor ${CAPACITOR_SHELL_TEMPLATE.capacitor}. Move the app to Capacitor ${major(CAPACITOR_SHELL_TEMPLATE.capacitor)}.`);
    }
    packages.push({
      id: entry.id,
      targetSdk: CAPACITOR_SHELL_TEMPLATE.targetSdk,
      icon: iconBytes ? iconProblems(iconBytes) : [`The icon ${entry.application.icon} is not in the project.`],
      permissions: (entry.permissions || []).flatMap(({ id, reason }) => [
        ...(ANDROID_PERMISSIONS[id] ? [] : [`Permission ${id} is not one Vibe64 knows (${Object.keys(ANDROID_PERMISSIONS).join(", ")}).`]),
        ...(String(reason || "").trim().length >= 10 ? [] : [`Permission ${id} needs a reason a person would understand.`])
      ]),
      plugins
    });
  }
  const java = await describeJdk({ javaHome: toolchains.javaHome });
  const androidSdk = await describeAndroidSdk({ androidHome: toolchains.androidHome });
  return {
    packages,
    toolchain: { java: java.ok ? java.version : null, javaMessage: java.message, androidSdk: androidSdk.ok, androidSdkMessage: androidSdk.message },
    developerVerification
  };
}

function eachPackage(android, field) {
  const problems = (android?.packages || []).flatMap((entry) => entry[field].map((message) => `${entry.id}: ${message}`));
  return problems.length ? { ok: false, message: problems.join(" ") } : { ok: true };
}

const applies = ({ android }) => Boolean(android?.packages?.length);

const androidTargetSdk = definePreflightCheck({
  id: "android-target-sdk",
  label: "Android target level",
  severity: "block",
  applies,
  run: ({ android }) => {
    const low = android.packages.filter((entry) => !(entry.targetSdk >= REQUIRED_TARGET_SDK));
    return low.length
      ? { ok: false, message: `${low.map(({ id }) => id).join(", ")} must target Android API ${REQUIRED_TARGET_SDK} or later.` }
      : { ok: true, message: `Targets Android API ${android.packages[0].targetSdk}.` };
  }
});

const androidIcon = definePreflightCheck({
  id: "android-icon",
  label: "App icon",
  severity: "block",
  applies,
  run: ({ android }) => {
    const result = eachPackage(android, "icon");
    return result.ok ? { ok: true, message: "1024×1024 PNG without transparency." } : result;
  }
});

const androidPermissions = definePreflightCheck({
  id: "android-permissions",
  label: "Permissions",
  severity: "block",
  applies,
  run: ({ android }) => {
    const result = eachPackage(android, "permissions");
    return result.ok ? { ok: true, message: "Every permission is known and explained." } : result;
  }
});

const androidPlugins = definePreflightCheck({
  id: "android-plugins",
  label: "Native plugins",
  severity: "block",
  applies,
  run: ({ android }) => {
    const result = eachPackage(android, "plugins");
    return result.ok ? { ok: true, message: "The app shell gets exactly the plugins in the app's lockfile." } : result;
  }
});

const androidToolchain = definePreflightCheck({
  id: "android-toolchain",
  label: "Android build tools",
  severity: "block",
  applies,
  run: ({ android }) => {
    const { java, javaMessage, androidSdk, androidSdkMessage } = android.toolchain || {};
    if (!java) return { ok: false, message: javaMessage || "Java 21 is not set up." };
    if (!androidSdk) return { ok: false, message: androidSdkMessage || "The Android SDK is not set up." };
    return { ok: true, message: `Java ${java} and the Android SDK are ready.` };
  }
});

const androidDeveloperVerification = definePreflightCheck({
  id: "android-developer-verification",
  label: "Android developer verification",
  severity: "warn",
  applies,
  run: ({ android }) => android.developerVerification === "registered"
    ? { ok: true, message: "Your developer identity is registered with Google." }
    : {
      ok: false,
      message: "Since 30 September 2026, phones in Brazil, Indonesia, Singapore and Thailand install apps only from verified developers; this goes worldwide in 2027. Elsewhere, installing on your own phone still works."
    }
});

// The Android checks alone, and composed after the shared checks.
const ANDROID_CHECKS = Object.freeze([
  androidTargetSdk,
  androidIcon,
  androidPermissions,
  androidPlugins,
  androidToolchain,
  androidDeveloperVerification
]);
const VIBE64_ANDROID_PREFLIGHT_CHECKS = Object.freeze([...VIBE64_PREFLIGHT_CHECKS, ...ANDROID_CHECKS]);

export { ANDROID_CHECKS, REQUIRED_TARGET_SDK, VIBE64_ANDROID_PREFLIGHT_CHECKS, gatherAndroidFacts };
