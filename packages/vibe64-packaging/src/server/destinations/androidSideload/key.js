// The sideload distribution key: the one key every "install on my phone" APK of
// an app is signed with. Android installs an update only when it carries the
// same key, so losing it ends update continuity; the caller keeps it, with a
// recovery copy, wherever its custody policy says. This module only creates it
// in a private temporary folder and hands the bytes to the caller's sink.
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { publishError } from "../../errors.js";
import { spawnCommand } from "../../stages.js";
import { toolEnvironment } from "../../toolchains/download.js";

const SIDELOAD_KEY_ALIAS = "vibe64-sideload";
const SIDELOAD_KEY_VALIDITY_DAYS = 10_000;
const PASSWORD_VARIABLE = "VIBE64_SIDELOAD_KEY_PASSWORD";

function keyError(message, details) {
  return publishError("VIBE64_PUBLISH_KEY_FAILED", message, details);
}

function keytool(javaHome) {
  if (typeof javaHome !== "string" || !path.isAbsolute(javaHome)) throw keyError("Creating a key needs a Java home.");
  return path.join(javaHome, "bin", "keytool");
}

function distinguishedName(commonName) {
  const name = String(commonName || "").replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 64);
  return `CN=${name || "Vibe64 app"}`;
}

async function runKeytool(javaHome, args, { cwd, password, runCommand = spawnCommand }) {
  const result = await runCommand({
    command: keytool(javaHome),
    args,
    cwd,
    env: toolEnvironment(process.env, { HOME: cwd, [PASSWORD_VARIABLE]: password })
  });
  if (result?.ok !== true) {
    // keytool never echoes the password; its output is still kept short.
    throw keyError("keytool failed.", { exitCode: result?.exitCode ?? null, output: `${result?.stdout || ""}${result?.stderr || ""}`.slice(-2000) });
  }
  return result;
}

// The SHA-256 of a DER certificate, as apksigner prints it.
function certificateDigest(der) {
  return createHash("sha256").update(der).digest("hex");
}

// Creates a PKCS#12 key store holding a new RSA-4096 sideload key and gives the
// caller's sink { keystore, password, alias, certificateSha256 } (buffers it may
// keep; they are zeroed after the sink returns). Returns only public facts.
async function generateSideloadKey({ javaHome, commonName, sink, tempRoot = os.tmpdir() } = {}, { runCommand = spawnCommand } = {}) {
  if (typeof sink !== "function") throw keyError("Creating a key needs a sink that keeps it.");
  const directory = await mkdtemp(path.join(tempRoot, "vibe64-sideload-key-"));
  const password = Buffer.from(randomBytes(32).toString("base64url"), "utf8");
  let keystore = null;
  try {
    await chmod(directory, 0o700);
    const store = path.join(directory, "sideload.p12");
    const certificate = path.join(directory, "sideload.der");
    const passwordText = password.toString("utf8");
    const common = ["-keystore", store, "-storetype", "PKCS12", "-alias", SIDELOAD_KEY_ALIAS, "-storepass:env", PASSWORD_VARIABLE];
    await runKeytool(javaHome, [
      "-genkeypair", ...common,
      "-keypass:env", PASSWORD_VARIABLE,
      "-keyalg", "RSA", "-keysize", "4096", "-sigalg", "SHA256withRSA",
      "-validity", String(SIDELOAD_KEY_VALIDITY_DAYS),
      "-dname", distinguishedName(commonName),
      "-noprompt"
    ], { cwd: directory, password: passwordText, runCommand });
    await runKeytool(javaHome, ["-exportcert", ...common, "-file", certificate], { cwd: directory, password: passwordText, runCommand });
    const certificateSha256 = certificateDigest(await readFile(certificate));
    keystore = await readFile(store);
    await sink({ keystore, password, alias: SIDELOAD_KEY_ALIAS, certificateSha256 });
    return { alias: SIDELOAD_KEY_ALIAS, certificateSha256, algorithm: "RSA-4096", validityDays: SIDELOAD_KEY_VALIDITY_DAYS };
  } finally {
    password.fill(0);
    keystore?.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
}

export { PASSWORD_VARIABLE, SIDELOAD_KEY_ALIAS, certificateDigest, generateSideloadKey };
