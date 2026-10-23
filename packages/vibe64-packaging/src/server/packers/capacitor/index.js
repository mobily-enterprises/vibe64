// The capacitor packer: a native Android app around a web-bundle package, in a
// shell Vibe64 generates for every build and throws away (the project carries no
// native project). Stage 1 makes one unsigned APK.
import { open } from "node:fs/promises";
import path from "node:path";

import { publishError } from "../../errors.js";
import { describeJdk } from "../../toolchains/jdk.js";
import { capacitorRecipe } from "./buildApk.js";
import { CAPACITOR_SHELL_TEMPLATE, shellTemplateRecord } from "./shellTemplate/index.js";

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

async function startsWithZipMagic(file) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(4);
    await handle.read(buffer, 0, 4, 0);
    return buffer.equals(ZIP_MAGIC);
  } finally {
    await handle.close();
  }
}

const capacitorPacker = Object.freeze({
  id: "capacitor",
  label: "Mobile app",
  produces: Object.freeze(["Android APK"]),
  implemented: true,
  buildRecipe: capacitorRecipe,
  // After Stage 1: exactly one unsigned APK.
  checkArtifacts: async ({ artifacts }) => {
    const files = artifacts.manifest.files;
    if (files.length !== 1 || !files[0].path.endsWith("-unsigned.apk")) {
      throw publishError("VIBE64_PUBLISH_BUILD_INVALID", "An Android build must produce exactly one unsigned APK.");
    }
    if (!await startsWithZipMagic(path.join(artifacts.directory, "files", files[0].path))) {
      throw publishError("VIBE64_PUBLISH_BUILD_INVALID", `${files[0].path} is not an APK.`);
    }
    return { files: [files[0].path], apk: files[0].path, sha256: files[0].sha256 };
  },
  templates: () => shellTemplateRecord(),
  toolVersions: async ({ toolchains = {} } = {}) => {
    const jdk = await describeJdk({ javaHome: toolchains.javaHome });
    return {
      java: jdk.ok ? jdk.version : "missing",
      "android-build-tools": CAPACITOR_SHELL_TEMPLATE.buildTools,
      "android-platform": CAPACITOR_SHELL_TEMPLATE.platform,
      node: process.versions.node
    };
  }
});

export { capacitorPacker };
