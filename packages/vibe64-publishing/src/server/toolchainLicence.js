// Android build tools on this computer: the person reads and accepts Google's
// Android SDK licence in Vibe64 (never accepted on their behalf), the
// acceptance is recorded in their own publishing folder, and only then are the
// pinned JDK and SDK downloaded into the toolchains folder (a user cache folder,
// never a system location).
import path from "node:path";

import {
  androidSdkLicence,
  findAndroidSdk,
  findJdk,
  installAndroidSdk,
  installJdk
} from "@local/vibe64-packaging/server/toolchains";

import { readJsonFile, writeJsonFile } from "./state/jsonFile.js";

const LICENCES_CONTRACT = "vibe64.publishing-licences.v1";

function licenceError(message, code = "vibe64_publishing_licence_invalid") {
  return Object.assign(new Error(message), { code });
}

function createToolchainManager({
  personalRoot,
  toolchainsRoot,
  now = () => new Date().toISOString(),
  fetchLicence = androidSdkLicence,
  installers = { installJdk, installAndroidSdk },
  finders = { findJdk, findAndroidSdk }
} = {}) {
  if (!path.isAbsolute(personalRoot || "") || !path.isAbsolute(toolchainsRoot || "")) {
    throw new TypeError("Toolchains need the personal publishing folder and a toolchains folder.");
  }
  const licencesFile = path.join(personalRoot, "licences.json");
  const androidHome = path.join(toolchainsRoot, "android-sdk");
  let licenceCache = null;
  let install = null; // { startedAt, status, message }

  async function acceptances() {
    const value = await readJsonFile(licencesFile, () => ({ contract: LICENCES_CONTRACT, accepted: [] }));
    return value?.contract === LICENCES_CONTRACT ? value.accepted : [];
  }

  async function licence() {
    if (!licenceCache) licenceCache = await fetchLicence();
    return licenceCache;
  }

  async function status() {
    const [jdk, sdk, accepted] = await Promise.all([
      finders.findJdk({ directory: toolchainsRoot }),
      finders.findAndroidSdk({ directory: androidHome }),
      acceptances()
    ]);
    return {
      toolchainsRoot,
      java: { ready: jdk.ok, version: jdk.version || null, javaHome: jdk.ok ? jdk.javaHome : null, message: jdk.message || "" },
      androidSdk: { ready: sdk.ok, androidHome: sdk.ok ? sdk.androidHome : null, message: sdk.message || "" },
      androidLicence: accepted.find((entry) => entry.id?.startsWith("android-sdk")) || null,
      install: install ? { ...install } : null
    };
  }

  // { javaHome, androidHome } when both are ready, else null.
  async function androidToolchains() {
    const current = await status();
    return current.java.ready && current.androidSdk.ready
      ? { javaHome: current.java.javaHome, androidHome: current.androidSdk.androidHome }
      : null;
  }

  async function accept({ id, hash, acceptedBy }) {
    const text = await licence();
    if (id !== text.id || hash !== text.hash) {
      throw licenceError("The licence changed after it was shown. Read it again before accepting.", "vibe64_publishing_licence_changed");
    }
    if (typeof acceptedBy !== "string" || !acceptedBy.trim()) throw licenceError("A licence acceptance records who accepted it.");
    const record = { id, hash, acceptedBy: acceptedBy.trim().slice(0, 200), acceptedAt: now() };
    const accepted = (await acceptances()).filter((entry) => entry.id !== id);
    await writeJsonFile(licencesFile, { contract: LICENCES_CONTRACT, accepted: [...accepted, record] });
    return record;
  }

  // Downloads the JDK and SDK in the background after the recorded acceptance.
  async function installAndroid() {
    if (install?.status === "running") return { ...install };
    const recorded = (await acceptances()).find((entry) => entry.id?.startsWith("android-sdk"));
    if (!recorded) throw licenceError("Accept the Android SDK licence first.", "vibe64_publishing_licence_not_accepted");
    install = { startedAt: now(), status: "running", message: "Downloading Java and the Android build tools…" };
    (async () => {
      try {
        const jdk = await installers.installJdk({ directory: toolchainsRoot });
        install = { ...install, message: "Downloading the Android SDK…" };
        await installers.installAndroidSdk({ directory: androidHome, acceptance: recorded, javaHome: jdk.javaHome });
        install = { ...install, status: "done", finishedAt: now(), message: "Android build tools are ready." };
      } catch (error) {
        install = { ...install, status: "failed", finishedAt: now(), message: error?.message || "The download failed." };
      }
    })();
    return { ...install };
  }

  return Object.freeze({ accept, androidToolchains, installAndroid, licence, status, toolchainsRoot });
}

export { createToolchainManager };
