// The age v1 file format (https://age-encryption.org/v1) with its passphrase
// (scrypt) recipient, built on Node's own crypto. Files this writes open with
// any age implementation (`age -d`), so a person's publishing keys and recovery
// kits never depend on Vibe64 to be read.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const INTRO = "age-encryption.org/v1";
const SCRYPT_LABEL = "age-encryption.org/v1/scrypt";
const CHUNK = 64 * 1024;
const TAG = 16;
const DEFAULT_WORK_FACTOR = 18;
const MAX_WORK_FACTOR = 22;
const MIN_PASSPHRASE = 12;

function ageError(message, code = "vibe64_age_invalid") {
  return Object.assign(new Error(message), { code });
}

function encode(bytes) {
  return Buffer.from(bytes).toString("base64").replace(/=+$/u, "");
}

function decode(text) {
  if (!/^[A-Za-z0-9+/]*$/u.test(text)) throw ageError("The age header is not valid base64.");
  const bytes = Buffer.from(text, "base64");
  if (encode(bytes) !== text) throw ageError("The age header is not canonical base64.");
  return bytes;
}

function hkdf(key, salt, info) {
  return Buffer.from(hkdfSync("sha256", key, salt, Buffer.from(info, "utf8"), 32));
}

function seal(key, nonce, plaintext) {
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

function open(key, nonce, sealed) {
  if (sealed.length < TAG) throw ageError("The age data is truncated.");
  const decipher = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG });
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
  } catch {
    return null;
  }
}

function streamNonce(counter, last) {
  const nonce = Buffer.alloc(12);
  nonce.writeUIntBE(counter, 5, 6);
  nonce[11] = last ? 1 : 0;
  return nonce;
}

function passphraseBytes(passphrase) {
  const text = Buffer.isBuffer(passphrase) ? passphrase.toString("utf8") : String(passphrase ?? "");
  if ([...text].length < MIN_PASSPHRASE) {
    throw ageError(`A passphrase needs at least ${MIN_PASSPHRASE} characters.`, "vibe64_age_passphrase_short");
  }
  return Buffer.from(text, "utf8");
}

async function wrapKey(passphrase, salt, workFactor) {
  const N = 2 ** workFactor;
  return scrypt(passphrase, Buffer.concat([Buffer.from(SCRYPT_LABEL, "utf8"), salt]), 32, {
    N, r: 8, p: 1, maxmem: 256 * N * 8 + 16 * 1024 * 1024
  });
}

function wrapLines(text) {
  const lines = [];
  for (let index = 0; index < text.length; index += 64) lines.push(text.slice(index, index + 64));
  if (!lines.length || lines.at(-1).length === 64) lines.push("");
  return lines.join("\n");
}

async function ageEncrypt(plaintext, passphrase, { workFactor = DEFAULT_WORK_FACTOR } = {}) {
  if (!Number.isInteger(workFactor) || workFactor < 10 || workFactor > MAX_WORK_FACTOR) throw ageError("The scrypt work factor is out of range.");
  const data = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), "utf8");
  const fileKey = randomBytes(16);
  const salt = randomBytes(16);
  const key = await wrapKey(passphraseBytes(passphrase), salt, workFactor);
  const body = seal(key, Buffer.alloc(12), fileKey);
  const header = `${INTRO}\n-> scrypt ${encode(salt)} ${workFactor}\n${wrapLines(encode(body))}\n---`;
  const mac = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(header, "utf8").digest();
  const nonce = randomBytes(16);
  const streamKey = hkdf(fileKey, nonce, "payload");
  const chunks = [];
  const count = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let index = 0; index < count; index += 1) {
    chunks.push(seal(streamKey, streamNonce(index, index === count - 1), data.subarray(index * CHUNK, (index + 1) * CHUNK)));
  }
  fileKey.fill(0);
  key.fill(0);
  return Buffer.concat([Buffer.from(`${header} ${encode(mac)}\n`, "utf8"), nonce, ...chunks]);
}

// Reads the header: exactly one scrypt stanza, then the MAC line.
function parseHeader(bytes) {
  const lines = [];
  let offset = 0;
  for (;;) {
    const end = bytes.indexOf(0x0a, offset);
    if (end === -1) throw ageError("This is not an age file.");
    const line = bytes.subarray(offset, end).toString("latin1");
    lines.push(line);
    offset = end + 1;
    if (line.startsWith("---")) break;
    if (lines.length > 64) throw ageError("The age header is too long.");
  }
  if (lines[0] !== INTRO) throw ageError("This is not an age v1 file.");
  const stanzaLine = lines[1] || "";
  const parts = stanzaLine.split(" ");
  if (parts[0] !== "->" || parts[1] !== "scrypt" || parts.length !== 4) {
    throw ageError("This age file is not protected by a passphrase.", "vibe64_age_not_passphrase");
  }
  const bodyLines = [];
  let index = 2;
  for (; index < lines.length - 1; index += 1) {
    bodyLines.push(lines[index]);
    if (lines[index].length < 64) break;
  }
  if (index !== lines.length - 2) throw ageError("A passphrase age file has exactly one recipient.");
  const macLine = lines.at(-1);
  if (!macLine.startsWith("--- ")) throw ageError("The age header has no MAC.");
  const workFactor = Number(parts[3]);
  if (!/^[1-9]\d?$/u.test(parts[3]) || workFactor > MAX_WORK_FACTOR) throw ageError("The age scrypt work factor is out of range.");
  const salt = decode(parts[2]);
  if (salt.length !== 16) throw ageError("The age scrypt salt is not 16 bytes.");
  const body = decode(bodyLines.join(""));
  if (body.length !== 32) throw ageError("The age scrypt stanza is malformed.");
  const headerText = bytes.subarray(0, offset - macLine.length - 1).toString("latin1") + "---";
  return { salt, workFactor, body, mac: decode(macLine.slice(4)), headerText, payloadOffset: offset };
}

async function ageDecrypt(ciphertext, passphrase) {
  const bytes = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  const header = parseHeader(bytes);
  const key = await wrapKey(passphraseBytes(passphrase), header.salt, header.workFactor);
  const fileKey = open(key, Buffer.alloc(12), header.body);
  key.fill(0);
  if (!fileKey) throw ageError("That passphrase does not open these keys.", "vibe64_age_wrong_passphrase");
  try {
    const expected = createHmac("sha256", hkdf(fileKey, Buffer.alloc(0), "header")).update(header.headerText, "utf8").digest();
    if (header.mac.length !== expected.length || !timingSafeEqual(header.mac, expected)) throw ageError("The age header was changed.");
    const payload = bytes.subarray(header.payloadOffset);
    if (payload.length < 16 + TAG) throw ageError("The age payload is truncated.");
    const streamKey = hkdf(fileKey, payload.subarray(0, 16), "payload");
    const chunks = [];
    let position = 16;
    for (let counter = 0; ; counter += 1) {
      const remaining = payload.length - position;
      const last = remaining <= CHUNK + TAG;
      const sealed = payload.subarray(position, position + (last ? remaining : CHUNK + TAG));
      const chunk = open(streamKey, streamNonce(counter, last), sealed);
      if (!chunk) throw ageError("The age payload was changed or truncated.");
      if (last && chunk.length === 0 && counter > 0) throw ageError("The age payload ends with an empty chunk.");
      chunks.push(chunk);
      position += sealed.length;
      if (last) break;
    }
    return Buffer.concat(chunks);
  } finally {
    fileKey.fill(0);
  }
}

export { DEFAULT_WORK_FACTOR, MIN_PASSPHRASE, ageDecrypt, ageEncrypt };
