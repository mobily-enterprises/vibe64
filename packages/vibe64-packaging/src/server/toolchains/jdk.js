// The Java toolchain Android builds need (Capacitor 8 compiles for Java 21). A
// JDK the person already has (JAVA_HOME or `java` on PATH) is used when it is new
// enough; otherwise Vibe64 installs a pinned, checksum-verified Eclipse Temurin
// build into the folder its caller names (always a user-space folder).
import path from "node:path";

import { spawnCommand } from "../stages.js";
import { downloadVerified, exists, toolchainEnvironment, toolchainError, unpackInto } from "./download.js";

const REQUIRED_JAVA = 21;
const TEMURIN_LICENCE = Object.freeze({
  id: "gpl-2.0-classpath-exception",
  label: "GNU General Public License v2 with the Classpath Exception",
  url: "https://adoptium.net/about/"
});
const PINNED_JDKS = Object.freeze({
  "linux-x64": Object.freeze({
    version: "21.0.13+9",
    folder: "jdk-21.0.13+9",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.13%2B9/OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz",
    file: "OpenJDK21U-jdk_x64_linux_hotspot_21.0.13_9.tar.gz",
    size: 207858352,
    sha256: "d7f5d5cf865a2902b70ff549b97586a7d3f234e016f041ab447ea740c7d66d1c"
  }),
  "linux-arm64": Object.freeze({
    version: "21.0.12.1+1",
    folder: "jdk-21.0.12.1+1",
    url: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
    file: "OpenJDK21U-jdk_aarch64_linux_hotspot_21.0.12.1_1.tar.gz",
    size: 205641175,
    sha256: "23e37e026f12f3e706f18938ff611db3032d075b09d0879a25d06718c773e223"
  })
});

function hostPlatform(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

// `java -version` of one Java home: { ok, javaHome, version, major, message }.
async function describeJdk({ javaHome, baseEnvironment = process.env } = {}, { runCommand = spawnCommand } = {}) {
  if (typeof javaHome !== "string" || !path.isAbsolute(javaHome)) return { ok: false, javaHome: null, message: "No Java home given." };
  const java = path.join(javaHome, "bin", "java");
  if (!await exists(java)) return { ok: false, javaHome, message: `${javaHome} has no bin/java.` };
  const result = await runCommand({ command: java, args: ["-version"], cwd: javaHome, env: toolchainEnvironment(baseEnvironment) });
  const match = /version "(\d+)(?:\.[^"]*)?"/u.exec(`${result?.stderr || ""}${result?.stdout || ""}`);
  if (result?.ok !== true || !match) return { ok: false, javaHome, message: `${java} did not report a version.` };
  const major = Number(match[1]);
  const version = /version "([^"]+)"/u.exec(`${result.stderr}${result.stdout}`)[1];
  if (major < REQUIRED_JAVA) {
    return { ok: false, javaHome, version, major, message: `Java ${version} is too old; Android builds need Java ${REQUIRED_JAVA} or newer.` };
  }
  return { ok: true, javaHome, version, major, message: `Java ${version}.` };
}

// The Java home of `java` on PATH, read from the JVM itself.
async function javaHomeOnPath({ baseEnvironment = process.env } = {}, { runCommand = spawnCommand } = {}) {
  const result = await runCommand({
    command: "java",
    args: ["-XshowSettings:properties", "-version"],
    cwd: "/",
    env: toolchainEnvironment(baseEnvironment)
  });
  const match = /^\s*java\.home = (.+)$/mu.exec(`${result?.stderr || ""}${result?.stdout || ""}`);
  return result?.ok === true && match ? match[1].trim() : null;
}

// The first usable JDK: Vibe64's own install in `directory`, then JAVA_HOME, then PATH.
async function findJdk({ directory = null, baseEnvironment = process.env, platform = hostPlatform() } = {}, dependencies = {}) {
  const candidates = [];
  const pinned = PINNED_JDKS[platform];
  if (directory && pinned) candidates.push(path.join(directory, pinned.folder));
  if (baseEnvironment.JAVA_HOME) candidates.push(baseEnvironment.JAVA_HOME);
  const onPath = await javaHomeOnPath({ baseEnvironment }, dependencies);
  if (onPath) candidates.push(onPath);
  const tried = [];
  for (const javaHome of [...new Set(candidates)]) {
    const description = await describeJdk({ javaHome, baseEnvironment }, dependencies);
    if (description.ok) return description;
    tried.push(description.message);
  }
  return { ok: false, javaHome: null, message: tried.length ? tried.join(" ") : `No Java ${REQUIRED_JAVA} found.`, installable: Boolean(pinned) };
}

// Installs the pinned Temurin JDK into `directory` (idempotent) and returns it.
async function installJdk({ directory, platform = hostPlatform(), baseEnvironment = process.env, signal } = {}, dependencies = {}) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw toolchainError("The JDK needs an absolute install folder.");
  const pinned = PINNED_JDKS[platform];
  if (!pinned) throw toolchainError(`Vibe64 has no pinned JDK for ${platform}; install Java ${REQUIRED_JAVA} and set JAVA_HOME.`);
  const archive = await downloadVerified(pinned, path.join(directory, "downloads"), { fetchImpl: dependencies.fetchImpl, signal });
  const javaHome = await unpackInto(archive, path.join(directory, pinned.folder), {
    inner: pinned.folder,
    kind: "tar",
    baseEnvironment,
    runCommand: dependencies.runCommand
  });
  const description = await describeJdk({ javaHome, baseEnvironment }, dependencies);
  if (!description.ok) throw toolchainError(description.message);
  return { ...description, licence: TEMURIN_LICENCE };
}

export { PINNED_JDKS, REQUIRED_JAVA, TEMURIN_LICENCE, describeJdk, findJdk, hostPlatform, installJdk };
