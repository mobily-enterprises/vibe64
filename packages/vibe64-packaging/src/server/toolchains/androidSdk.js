// The Android SDK an APK build needs: platform android-36 and the build-tools
// AGP expects (which also hold zipalign and apksigner). The SDK licence binds
// the person who accepts it, so Vibe64 never accepts it for them:
// androidSdkLicence() returns the text and its hash for the caller to show, and
// installAndroidSdk() refuses to download anything unless the caller passes the
// person's recorded acceptance of exactly that text. The SDK goes into the folder
// the caller names (always user-space) with Google's own `sdkmanager`; nothing
// is redistributed and nothing is written to the real home folder.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { publishError } from "../errors.js";
import { CAPACITOR_SHELL_TEMPLATE } from "../packers/capacitor/shellTemplate/index.js";
import { spawnCommand } from "../stages.js";
import { downloadVerified, exists, runOrFail, toolEnvironment, toolchainError, unpackInto } from "./download.js";

const ANDROID_REPOSITORY_URL = "https://dl.google.com/android/repository/repository2-3.xml";
const ANDROID_TERMS_URL = "https://developer.android.com/studio/terms";
const ANDROID_LICENCE_ID = "android-sdk-license";
const ACCEPTANCE_FILE = "vibe64-licence-acceptance.json";
const SDK_PACKAGES = Object.freeze([
  `platforms;${CAPACITOR_SHELL_TEMPLATE.platform}`,
  `build-tools;${CAPACITOR_SHELL_TEMPLATE.buildTools}`
]);
// Command-line tools 23.0 (sdkmanager); Google publishes SHA-1, Vibe64 pins SHA-256.
const PINNED_COMMAND_LINE_TOOLS = Object.freeze({
  "linux-x64": Object.freeze({
    version: "23.0",
    url: "https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip",
    file: "commandlinetools-linux-16111833_latest.zip",
    size: 181052239,
    sha256: "0877a1d048fe4a24efe2eff536ca4223f7adeb58648bb81909d33c446918cfa8"
  })
});

function xmlUnescape(text) {
  return text
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&apos;/gu, "'")
    .replace(/&#(\d+);/gu, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/gu, "&");
}

function licenceHash(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

// The licence text exactly as Google's SDK repository publishes it.
function licenceFromRepository(xml, id = ANDROID_LICENCE_ID) {
  const match = new RegExp(`<license id="${id}" type="text">([\\s\\S]*?)</license>`, "u").exec(String(xml || ""));
  if (!match) throw toolchainError(`Google's SDK repository has no ${id} text.`);
  const text = xmlUnescape(match[1]).trim();
  return { id, text, hash: licenceHash(text), termsUrl: ANDROID_TERMS_URL, packages: [...SDK_PACKAGES] };
}

async function fetchRepository({ fetchImpl = fetch, repositoryUrl = ANDROID_REPOSITORY_URL, signal } = {}) {
  let response;
  try {
    response = await fetchImpl(repositoryUrl, { redirect: "follow", signal });
  } catch (error) {
    throw toolchainError(`Could not reach Google's SDK repository: ${error?.cause?.code || error?.name || "network error"}.`);
  }
  if (!response.ok) throw toolchainError(`Google's SDK repository answered HTTP ${response.status}.`);
  return response.text();
}

// What the caller shows the person before anything is downloaded.
async function androidSdkLicence(options = {}) {
  return licenceFromRepository(await fetchRepository(options));
}

function assertAcceptance(acceptance, licence) {
  if (!acceptance || acceptance.id !== licence.id || acceptance.hash !== licence.hash) {
    throw publishError(
      "VIBE64_PUBLISH_LICENCE_NOT_ACCEPTED",
      "The Android SDK licence has not been accepted. Show it to the person and pass their recorded acceptance.",
      { licence: licence.id, hash: licence.hash }
    );
  }
  if (typeof acceptance.acceptedBy !== "string" || !acceptance.acceptedBy.trim() || Number.isNaN(Date.parse(acceptance.acceptedAt || ""))) {
    throw publishError("VIBE64_PUBLISH_LICENCE_NOT_ACCEPTED", "A licence acceptance records who accepted it and when.");
  }
}

function buildToolsOf(androidHome) {
  const root = path.join(androidHome, "build-tools", CAPACITOR_SHELL_TEMPLATE.buildTools);
  return {
    root,
    zipalign: path.join(root, "zipalign"),
    apksigner: path.join(root, "apksigner"),
    aapt2: path.join(root, "aapt2")
  };
}

// { ok, androidHome, missing: [package], buildTools } for one SDK folder.
async function describeAndroidSdk({ androidHome } = {}) {
  if (typeof androidHome !== "string" || !path.isAbsolute(androidHome)) {
    return { ok: false, androidHome: null, missing: [...SDK_PACKAGES], message: "No Android SDK folder given." };
  }
  const buildTools = buildToolsOf(androidHome);
  const missing = [];
  if (!await exists(path.join(androidHome, "platforms", CAPACITOR_SHELL_TEMPLATE.platform, "android.jar"))) missing.push(SDK_PACKAGES[0]);
  if (!await exists(buildTools.zipalign) || !await exists(buildTools.apksigner)) missing.push(SDK_PACKAGES[1]);
  return {
    ok: missing.length === 0,
    androidHome,
    missing,
    buildTools,
    message: missing.length ? `The Android SDK at ${androidHome} lacks ${missing.join(", ")}.` : "Android SDK ready."
  };
}

// The first complete SDK: Vibe64's install in `directory`, then ANDROID_HOME / ANDROID_SDK_ROOT.
async function findAndroidSdk({ directory = null, baseEnvironment = process.env } = {}) {
  const candidates = [directory, baseEnvironment.ANDROID_HOME, baseEnvironment.ANDROID_SDK_ROOT].filter((value) => typeof value === "string" && path.isAbsolute(value));
  let last = null;
  for (const androidHome of [...new Set(candidates)]) {
    last = await describeAndroidSdk({ androidHome });
    if (last.ok) return last;
  }
  return last || { ok: false, androidHome: null, missing: [...SDK_PACKAGES], message: "No Android SDK found." };
}

async function readAcceptance(directory) {
  try {
    return JSON.parse(await readFile(path.join(directory, ACCEPTANCE_FILE), "utf8"));
  } catch {
    return null;
  }
}

// Installs command-line tools and SDK_PACKAGES into `directory` after checking
// the acceptance against the licence Google publishes right now.
async function installAndroidSdk({
  directory,
  acceptance,
  javaHome,
  platform = `${process.platform}-${process.arch}`,
  baseEnvironment = process.env,
  repositoryUrl,
  signal
} = {}, { fetchImpl = fetch, runCommand = spawnCommand } = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw toolchainError("The Android SDK needs an absolute install folder.");
  if (typeof javaHome !== "string" || !path.isAbsolute(javaHome)) throw toolchainError("Installing the Android SDK needs a Java home.");
  const licence = licenceFromRepository(await fetchRepository({ fetchImpl, repositoryUrl, signal }));
  assertAcceptance(acceptance, licence);
  const tools = PINNED_COMMAND_LINE_TOOLS[platform];
  if (!tools) throw toolchainError(`Android builds are not available on ${platform}: Google publishes no Android build tools for it.`);
  const archive = await downloadVerified(tools, path.join(directory, "downloads"), { fetchImpl, signal });
  const commandLineTools = await unpackInto(archive, path.join(directory, "cmdline-tools", "latest"), {
    inner: "cmdline-tools",
    kind: "zip",
    baseEnvironment,
    runCommand
  });
  await writeFile(path.join(directory, ACCEPTANCE_FILE), `${JSON.stringify({
    id: licence.id,
    hash: licence.hash,
    acceptedBy: acceptance.acceptedBy,
    acceptedAt: acceptance.acceptedAt
  }, null, 2)}\n`, { mode: 0o644 });
  // sdkmanager runs with a private HOME and no stdin: it can never be answered
  // "yes" on the person's behalf, and leaves nothing in their home folder.
  const home = await mkdtemp(path.join(os.tmpdir(), "vibe64-sdkmanager-"));
  try {
    await runOrFail([
      path.join(commandLineTools, "bin", "sdkmanager"),
      `--sdk_root=${directory}`,
      ...SDK_PACKAGES
    ], {
      cwd: home,
      env: toolEnvironment(baseEnvironment, { HOME: home, JAVA_HOME: javaHome, ANDROID_USER_HOME: path.join(home, ".android") }),
      label: "Installing the Android SDK",
      runCommand
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  const description = await describeAndroidSdk({ androidHome: directory });
  if (!description.ok) throw toolchainError(description.message);
  return { ...description, licence: { id: licence.id, hash: licence.hash }, commandLineTools: tools.version };
}

export {
  ANDROID_LICENCE_ID,
  ANDROID_REPOSITORY_URL,
  ANDROID_TERMS_URL,
  PINNED_COMMAND_LINE_TOOLS,
  SDK_PACKAGES,
  androidSdkLicence,
  buildToolsOf,
  describeAndroidSdk,
  findAndroidSdk,
  installAndroidSdk,
  licenceFromRepository,
  readAcceptance
};
