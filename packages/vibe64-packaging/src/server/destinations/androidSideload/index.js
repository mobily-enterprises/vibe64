// "Android: install on my phone". Stage 2 aligns and signs the exact unsigned
// APK from Stage 1 with the app's sideload distribution key (supplied by the
// caller for this one operation), outside Gradle, with the pinned build-tools.
// The signed APK and its proof land next to the build in the result store; the
// caller serves it as a download and a QR code. Stage 3 re-verifies the
// signature and the bytes. Settings on the target:
//   { certificateSha256: the key phones already trust (update continuity),
//     keyAlias: the key's alias when it is not Vibe64's own }.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../../canonical.js";
import { publishError } from "../../errors.js";
import { nextVersionCode } from "../../packers/capacitor/generateShell.js";
import { spawnCommand } from "../../stages.js";
import { describeAndroidSdk } from "../../toolchains/androidSdk.js";
import { toolEnvironment } from "../../toolchains/download.js";
import { artifactFiles, settingsOf, withToolHome } from "../registryCommon.js";
import { SIDELOAD_KEY_ALIAS, generateSideloadKey } from "./key.js";

const SIDELOAD_PROOF_CONTRACT = "vibe64.android-sideload-proof.v1";
const KEYSTORE = Object.freeze({ id: "android-sideload-keystore", label: "Sideload distribution key", delivery: "file" });
const KEY_PASSWORD = Object.freeze({ id: "android-sideload-key-password", label: "Sideload key password", delivery: "file" });
const CERTIFICATE = /^[0-9a-f]{64}$/u;

function sideloadError(code, message, details) {
  return publishError(code, message, details);
}

function sideloadSettings(target) {
  const settings = settingsOf(target);
  const certificateSha256 = settings.certificateSha256 ? String(settings.certificateSha256).toLowerCase().replace(/:/gu, "") : null;
  if (certificateSha256 !== null && !CERTIFICATE.test(certificateSha256)) {
    throw sideloadError("VIBE64_PUBLISH_TARGET_INVALID", "The sideload key fingerprint must be a SHA-256 certificate digest.");
  }
  const keyAlias = settings.keyAlias || SIDELOAD_KEY_ALIAS;
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(keyAlias)) throw sideloadError("VIBE64_PUBLISH_TARGET_INVALID", "The key alias is letters, digits, dots, dashes or underscores.");
  return { certificateSha256, keyAlias };
}

function unsignedApk(artifacts) {
  const files = artifactFiles(artifacts);
  if (files.length !== 1 || !files[0].name.endsWith("-unsigned.apk")) {
    throw sideloadError("VIBE64_PUBLISH_ARTIFACT_INVALID", "Install on my phone signs exactly one unsigned APK.");
  }
  return files[0];
}

async function signingTools(toolchains = {}) {
  const sdk = await describeAndroidSdk({ androidHome: toolchains.androidHome });
  if (!sdk.ok) throw sideloadError("VIBE64_PUBLISH_TOOLCHAIN_MISSING", sdk.message, { missing: sdk.missing });
  if (typeof toolchains.javaHome !== "string" || !path.isAbsolute(toolchains.javaHome)) {
    throw sideloadError("VIBE64_PUBLISH_TOOLCHAIN_MISSING", "Signing needs a Java home.");
  }
  const java = path.join(toolchains.javaHome, "bin", "java");
  return {
    zipalign: sdk.buildTools.zipalign,
    aapt2: sdk.buildTools.aapt2,
    apksigner: [java, "-jar", path.join(sdk.buildTools.root, "lib", "apksigner.jar")],
    keytool: path.join(toolchains.javaHome, "bin", "keytool")
  };
}

async function run(argv, { cwd, home, failure, code = "VIBE64_PUBLISH_SIGN_FAILED", runCommand = spawnCommand }) {
  const result = await runCommand({ command: argv[0], args: argv.slice(1), cwd, env: toolEnvironment(process.env, { HOME: home }) });
  if (result?.ok !== true) {
    throw sideloadError(code, failure, { exitCode: result?.exitCode ?? null, output: `${result?.stdout || ""}${result?.stderr || ""}${result?.error || ""}`.slice(-4000) });
  }
  return result;
}

async function fileSha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// apksigner's own verdict and the signer's certificate digest.
async function verifySigned(tools, apk, home) {
  const result = await run([...tools.apksigner, "verify", "--print-certs", "--min-sdk-version", "24", apk], {
    cwd: home,
    home,
    failure: "The signed APK does not verify.",
    code: "VIBE64_PUBLISH_NOT_PROVEN"
  });
  const digests = [...result.stdout.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$/gmu)].map((match) => match[1]);
  if (digests.length !== 1) throw sideloadError("VIBE64_PUBLISH_NOT_PROVEN", "The signed APK must have exactly one signer.");
  return digests[0];
}

// package name, versionCode, versionName and targetSdk from the APK's manifest.
async function badging(tools, apk, home) {
  const { stdout } = await run([tools.aapt2, "dump", "badging", apk], { cwd: home, home, failure: "The APK's manifest could not be read." });
  const value = (pattern) => pattern.exec(stdout)?.[1] ?? null;
  return {
    applicationId: value(/^package: name='([^']+)'/mu),
    versionCode: Number(value(/versionCode='(\d+)'/u)),
    versionName: value(/versionName='([^']*)'/u),
    targetSdk: Number(value(/^targetSdkVersion:'(\d+)'/mu))
  };
}

function publishedDirectory(artifacts, target) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(target?.id || "")) throw sideloadError("VIBE64_PUBLISH_TARGET_INVALID", "The target needs an id.");
  return path.join(artifacts.directory, "signed", target.id);
}

async function readProof(directory) {
  try {
    const proof = JSON.parse(await readFile(path.join(directory, "proof.json"), "utf8"));
    return proof?.contract === SIDELOAD_PROOF_CONTRACT ? proof : null;
  } catch {
    return null;
  }
}

// Stage 3: the stored signed APK still has the recorded bytes, verifies, and was
// made from exactly this build.
async function readBack({ target, artifacts, toolchains }) {
  const directory = publishedDirectory(artifacts, target);
  const proof = await readProof(directory);
  if (!proof) return { published: false };
  const file = path.join(directory, proof.file);
  if (!await stat(file).catch(() => null) || await fileSha256(file) !== proof.signedSha256) {
    throw sideloadError("VIBE64_PUBLISH_ARTIFACT_CHANGED", "The signed APK changed after it was signed.");
  }
  const tools = await signingTools(toolchains);
  const certificateSha256 = await withToolHome((home) => verifySigned(tools, file, home));
  if (certificateSha256 !== proof.certificateSha256) throw sideloadError("VIBE64_PUBLISH_NOT_PROVEN", "The signed APK's signer differs from its proof.");
  const { certificateSha256: expected } = sideloadSettings(target);
  if (expected && expected !== certificateSha256) {
    throw sideloadError("VIBE64_PUBLISH_KEY_MISMATCH", "This APK is signed with a different key from the one phones already trust.");
  }
  return {
    published: true,
    checksum: proof.artifactsDigest,
    proof: {
      file,
      fileName: proof.file,
      sha256: `sha256:${proof.signedSha256}`,
      size: proof.size,
      certificateSha256,
      applicationId: proof.applicationId,
      versionName: proof.versionName,
      versionCode: proof.versionCode
    }
  };
}

// Stage 2: zipalign (16 KB pages) and sign with apksigner, check the result,
// then store the signed APK and its proof atomically.
async function upload({ target, version, artifacts, credentials, toolchains }) {
  const { certificateSha256: expected, keyAlias } = sideloadSettings(target);
  const keystore = credentials?.files?.[KEYSTORE.id];
  const password = credentials?.files?.[KEY_PASSWORD.id];
  if (!keystore || !password) throw sideloadError("VIBE64_PUBLISH_CREDENTIAL_MISSING", "Signing needs the sideload distribution key and its password.");
  const apk = unsignedApk(artifacts);
  const tools = await signingTools(toolchains);
  const directory = publishedDirectory(artifacts, target);
  const name = apk.name.replace(/-unsigned\.apk$/u, ".apk");
  return withToolHome(async (home) => {
    const aligned = path.join(home, "aligned.apk");
    const signed = path.join(home, name);
    await run([tools.zipalign, "-P", "16", "-f", "4", apk.path, aligned], { cwd: home, home, failure: "zipalign failed." });
    await run([
      ...tools.apksigner, "sign",
      "--ks", keystore,
      "--ks-type", "PKCS12",
      "--ks-key-alias", keyAlias,
      "--ks-pass", `file:${password}`,
      "--v4-signing-enabled", "false",
      "--out", signed,
      aligned
    ], { cwd: home, home, failure: "apksigner could not sign the APK with this key." });
    const certificateSha256 = await verifySigned(tools, signed, home);
    if (expected && expected !== certificateSha256) {
      throw sideloadError("VIBE64_PUBLISH_KEY_MISMATCH", "This key is not the one phones already trust for this app, so they would refuse the update.");
    }
    const manifest = await badging(tools, signed, home);
    if (version && manifest.versionName !== version) {
      throw sideloadError("VIBE64_PUBLISH_VERSION_MISMATCH", `The APK is version ${manifest.versionName}, not ${version}.`);
    }
    const signedSha256 = await fileSha256(signed);
    const proof = {
      contract: SIDELOAD_PROOF_CONTRACT,
      target: target.id,
      file: name,
      size: (await stat(signed)).size,
      signedSha256,
      unsignedSha256: apk.sha256,
      artifactsDigest: artifacts.digest,
      certificateSha256,
      applicationId: manifest.applicationId,
      versionName: manifest.versionName,
      versionCode: manifest.versionCode,
      targetSdk: manifest.targetSdk
    };
    const staging = `${directory}.partial-${randomUUID()}`;
    try {
      await mkdir(staging, { recursive: true });
      await copyFile(signed, path.join(staging, name));
      await chmod(path.join(staging, name), 0o444);
      await writeFile(path.join(staging, "proof.json"), canonicalJson(proof), { mode: 0o444 });
      await mkdir(path.dirname(directory), { recursive: true });
      await rename(staging, directory);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
    return { file: path.join(directory, name), sha256: `sha256:${signedSha256}`, certificateSha256 };
  });
}

// Read-only: is it signed already, and does the key open and match?
async function dryRun({ target, version, artifacts, credentials, toolchains }) {
  const apk = unsignedApk(artifacts);
  const before = await readBack({ target, artifacts, toolchains });
  const key = credentials?.files?.[KEYSTORE.id] ? await verifyCredential({ target, credentials, toolchains }) : null;
  return {
    version,
    alreadyPublished: before.published,
    unsignedApk: apk.name,
    unsignedSha256: apk.sha256,
    key
  };
}

// Opens the key store with its password and compares the key with the one phones trust.
async function verifyCredential({ target, credentials, toolchains }) {
  const keystore = credentials?.files?.[KEYSTORE.id];
  const password = credentials?.files?.[KEY_PASSWORD.id];
  if (!keystore || !password) return { ok: false, message: "No sideload distribution key is set up." };
  const { certificateSha256: expected, keyAlias } = sideloadSettings(target);
  const tools = await signingTools(toolchains);
  return withToolHome(async (home) => {
    const certificate = path.join(home, "certificate.der");
    const passwordText = (await readFile(password, "utf8")).trim();
    const result = await spawnCommand({
      command: tools.keytool,
      args: ["-exportcert", "-keystore", keystore, "-storetype", "PKCS12", "-alias", keyAlias, "-storepass:env", "VIBE64_SIDELOAD_KEY_PASSWORD", "-file", certificate],
      cwd: home,
      env: toolEnvironment(process.env, { HOME: home, VIBE64_SIDELOAD_KEY_PASSWORD: passwordText })
    });
    if (result?.ok !== true) return { ok: false, verified: true, message: "The sideload key or its password does not open." };
    const certificateSha256 = createHash("sha256").update(await readFile(certificate)).digest("hex");
    if (expected && expected !== certificateSha256) {
      return { ok: false, verified: true, certificateSha256, message: "This is not the key phones already trust for this app." };
    }
    return { ok: true, verified: true, certificateSha256, message: "Sideload key ready." };
  });
}

const androidSideloadDestination = Object.freeze({
  id: "android-sideload",
  label: "Android: install on my phone",
  packers: Object.freeze(["capacitor"]),
  channels: Object.freeze([]),
  credentials: Object.freeze([KEYSTORE, KEY_PASSWORD]),
  implemented: true,
  dryRun,
  upload,
  readBack,
  verifyCredential
});

export {
  KEYSTORE as ANDROID_SIDELOAD_KEYSTORE,
  KEY_PASSWORD as ANDROID_SIDELOAD_KEY_PASSWORD,
  SIDELOAD_PROOF_CONTRACT,
  androidSideloadDestination,
  generateSideloadKey,
  nextVersionCode
};
