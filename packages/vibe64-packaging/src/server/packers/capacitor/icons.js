// The app icon: what preflight checks (a 1024x1024 PNG without transparency, the
// size and form stores require) and the Stage 1 step that turns it into launcher
// icons and launch screens on the pinned JDK.
import path from "node:path";
import { fileURLToPath } from "node:url";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICON_SIZE = 1024;
const ICON_PROGRAM = fileURLToPath(new URL("./ShellIcons.java", import.meta.url));
// PNG colour types: 4 (grey + alpha) and 6 (RGBA) carry an alpha channel.
const ALPHA_COLOR_TYPES = new Set([4, 6]);

// Reads the PNG header and chunk list (never the pixels): size, colour type and
// whether any transparency is possible.
function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { png: false };
  }
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return { png: false };
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let transparencyChunk = false;
  for (let offset = 8; offset + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    if (type === "tRNS") transparencyChunk = true;
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return { png: true, width, height, colorType, alpha: ALPHA_COLOR_TYPES.has(colorType) || transparencyChunk };
}

function iconProblems(buffer) {
  const details = inspectPng(buffer);
  if (!details.png) return ["The icon is not a PNG file."];
  const problems = [];
  if (details.width !== ICON_SIZE || details.height !== ICON_SIZE) {
    problems.push(`The icon is ${details.width}x${details.height}; it must be ${ICON_SIZE}x${ICON_SIZE}.`);
  }
  if (details.alpha) problems.push("The icon has transparency; stores need a square icon with no transparent pixels.");
  return problems;
}

function iconStep({ javaHome, icon, resourceRoot, cwd }) {
  return {
    label: "Generate launcher icons",
    argv: [path.join(javaHome, "bin", "java"), "-Djava.awt.headless=true", ICON_PROGRAM, icon, resourceRoot],
    cwd
  };
}

export { ICON_PROGRAM, ICON_SIZE, iconProblems, iconStep, inspectPng };
