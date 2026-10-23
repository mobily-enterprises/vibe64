// Fixtures for the Android packaging tests: real PNG icons, a web canary with a
// Capacitor lockfile, its Packaging section, and fake toolchain folders for the
// tests that never run Gradle.
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";

import { vibe64PackagingInspection } from "../../packages/vibe64-genesis/src/server/packaging.js";

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

// A valid PNG: a diagonal two-colour gradient, RGB or RGBA.
function pngBytes({ width = 1024, height = 1024, alpha = false } = {}) {
  const channels = alpha ? 4 : 3;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * channels);
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * channels;
      row[offset] = Math.round((x / width) * 255);
      row[offset + 1] = 90;
      row[offset + 2] = Math.round((y / height) * 255);
      if (alpha) row[offset + 3] = 200;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const PACKAGING_LINES = Object.freeze([
  "### Package `web`: Notes web client",
  "- Packer: `web-bundle`",
  "- Prepare `Install dependencies`: `npm` `ci`",
  "- Build `Build the client`: `npm` `run` `build`",
  "- Output: `dist`",
  "",
  "### Package `app`: Notes",
  "- Packer: `capacitor`",
  "- Content: package `web`",
  "- Platforms: `android`",
  "- Id: `dev.vibe64.canary.notes`",
  "- Name: `Notes`",
  "- Icon: `assets/icon-1024.png`",
  "- Version from: `package.json`",
  "- Permission `camera`: Take photos to attach to notes."
]);

function stackMarkdown(lines = PACKAGING_LINES) {
  return `# Stack\n\n## Components\n\n- \`nodejs\`\n\n## Connected development\n\n- Nothing.\n\n## Packaging\n\n${lines.join("\n")}\n`;
}

function packagingFor(lines = PACKAGING_LINES, environmentDefaults = []) {
  return vibe64PackagingInspection({
    environment: { stackHash: "sha256:stack", environmentDefaults },
    section: { status: "ready", stackHash: "sha256:stack", lines: [...lines] }
  });
}

const CANARY_DEPENDENCIES = Object.freeze({
  "@capacitor/core": "8.5.3",
  "@capacitor/haptics": "8.0.2",
  "@capacitor/preferences": "8.0.1"
});

function lockfile({ dependencies = CANARY_DEPENDENCIES, locked = {} } = {}) {
  const packages = {
    "": { name: "notes-canary", version: "1.4.2", dependencies: { ...dependencies } }
  };
  for (const [name, version] of Object.entries({ ...dependencies, ...locked })) {
    const entry = { version: locked[name] || version, license: "MIT" };
    if (name !== "@capacitor/core" && name.startsWith("@capacitor/")) entry.peerDependencies = { "@capacitor/core": ">=8.0.0" };
    packages[`node_modules/${name}`] = entry;
  }
  return { name: "notes-canary", version: "1.4.2", lockfileVersion: 3, requires: true, packages };
}

// The canary app's source files (no node_modules).
function canaryFiles({ dependencies = CANARY_DEPENDENCIES, locked = {}, icon = pngBytes(), version = "1.4.2", lock = null } = {}) {
  return {
    "genesis/stack.md": stackMarkdown(),
    "package.json": `${JSON.stringify({
      name: "notes-canary",
      version,
      private: true,
      type: "module",
      scripts: { build: "vite build" },
      dependencies: { ...dependencies },
      devDependencies: { vite: "8.3.5" }
    }, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify(lock || lockfile({ dependencies, locked }), null, 2)}\n`,
    "index.html": "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Notes</title></head><body><h1>Notes</h1><script type=\"module\" src=\"/src/main.js\"></script></body></html>\n",
    "src/main.js": "import { Haptics } from \"@capacitor/haptics\";\ndocument.querySelector(\"h1\").addEventListener(\"click\", () => Haptics.impact());\n",
    "assets/icon-1024.png": icon
  };
}

// A JDK and SDK that only look right: enough for recipes and preflight, never a build.
async function fakeToolchains(root) {
  const javaHome = path.join(root, "jdk");
  const androidHome = path.join(root, "sdk");
  await mkdir(path.join(javaHome, "bin"), { recursive: true });
  await writeFile(path.join(javaHome, "bin", "java"), "#!/bin/sh\necho 'openjdk version \"21.0.9\" 2026-10-21' >&2\n");
  await chmod(path.join(javaHome, "bin", "java"), 0o755);
  await mkdir(path.join(androidHome, "platforms", "android-36"), { recursive: true });
  await writeFile(path.join(androidHome, "platforms", "android-36", "android.jar"), "");
  await mkdir(path.join(androidHome, "build-tools", "35.0.0"), { recursive: true });
  for (const tool of ["zipalign", "apksigner", "aapt2"]) await writeFile(path.join(androidHome, "build-tools", "35.0.0", tool), "");
  return { javaHome, androidHome };
}

export { CANARY_DEPENDENCIES, PACKAGING_LINES, canaryFiles, fakeToolchains, lockfile, packagingFor, pngBytes, stackMarkdown };
