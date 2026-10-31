import { WORKER_COMMANDS_SOURCE } from "./agentPreviewBrowserWorkerCommands.js";
import { WORKER_STATE_SOURCE } from "./agentPreviewBrowserWorkerState.js";
import { computerPlaywrightModulePath } from "./computerPlaywright.js";

function documentReadyForScreenshot(browserDocument = globalThis.document) {
  return Boolean(
    browserDocument?.readyState === "complete" &&
    browserDocument.fonts?.status !== "loading" &&
    browserDocument.defaultView?.performance
      ?.getEntriesByName("first-contentful-paint")
      ?.length
  );
}

function pngVisualMetrics(pngBytes, inflatePng, {
  darkPixelThreshold = 0.1,
  maximumSampledPixels = 250_000
} = {}) {
  if (typeof inflatePng !== "function") {
    throw new Error("Managed preview screenshot PNG inflater is unavailable.");
  }
  const paethPredictor = (left, above, upperLeft) => {
    const estimate = left + above - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const aboveDistance = Math.abs(estimate - above);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
      return left;
    }
    return aboveDistance <= upperLeftDistance ? above : upperLeft;
  };
  const bytes = Buffer.isBuffer(pngBytes) ? pngBytes : Buffer.from(pngBytes || []);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < signature.length || !bytes.subarray(0, signature.length).equals(signature)) {
    throw new Error("Managed preview screenshot is not a PNG image.");
  }

  let offset = signature.length;
  let header = null;
  const imageDataChunks = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) {
      throw new Error("Managed preview screenshot has a truncated PNG chunk.");
    }
    const type = bytes.toString("ascii", typeOffset, dataOffset);
    if (type === "IHDR") {
      header = {
        bitDepth: bytes[dataOffset + 8],
        colorType: bytes[dataOffset + 9],
        compression: bytes[dataOffset + 10],
        filter: bytes[dataOffset + 11],
        height: bytes.readUInt32BE(dataOffset + 4),
        interlace: bytes[dataOffset + 12],
        width: bytes.readUInt32BE(dataOffset)
      };
    } else if (type === "IDAT") {
      imageDataChunks.push(bytes.subarray(dataOffset, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    offset = chunkEnd;
  }

  const channels = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4]
  ]).get(header?.colorType);
  if (
    !header ||
    header.bitDepth !== 8 ||
    header.compression !== 0 ||
    header.filter !== 0 ||
    header.interlace !== 0 ||
    !channels ||
    !header.width ||
    !header.height ||
    !imageDataChunks.length
  ) {
    throw new Error("Managed preview screenshot uses an unsupported PNG layout.");
  }

  const rowBytes = header.width * channels;
  const expectedBytes = header.height * (rowBytes + 1);
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(expectedBytes)) {
    throw new Error("Managed preview screenshot dimensions are unsafe.");
  }
  const inflated = inflatePng(Buffer.concat(imageDataChunks));
  if (inflated.length < expectedBytes) {
    throw new Error("Managed preview screenshot has incomplete PNG pixel data.");
  }

  const totalPixels = header.width * header.height;
  const samplingStep = Math.max(
    1,
    Math.ceil(Math.sqrt(totalPixels / Math.max(1, maximumSampledPixels)))
  );
  let previous = Buffer.alloc(rowBytes);
  let luminanceTotal = 0;
  let darkPixels = 0;
  let sampledPixels = 0;
  let inputOffset = 0;

  for (let y = 0; y < header.height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Buffer.allocUnsafe(rowBytes);
    for (let index = 0; index < rowBytes; index += 1) {
      const encoded = inflated[inputOffset + index];
      const left = index >= channels ? row[index - channels] : 0;
      const above = previous[index];
      const upperLeft = index >= channels ? previous[index - channels] : 0;
      let prediction = 0;
      if (filter === 1) {
        prediction = left;
      } else if (filter === 2) {
        prediction = above;
      } else if (filter === 3) {
        prediction = Math.floor((left + above) / 2);
      } else if (filter === 4) {
        prediction = paethPredictor(left, above, upperLeft);
      } else if (filter !== 0) {
        throw new Error("Managed preview screenshot uses an unsupported PNG filter.");
      }
      row[index] = (encoded + prediction) & 255;
    }
    inputOffset += rowBytes;

    if (y % samplingStep === 0) {
      for (let x = 0; x < header.width; x += samplingStep) {
        const index = x * channels;
        const grayscale = header.colorType === 0 || header.colorType === 4;
        const red = row[index];
        const green = grayscale ? row[index] : row[index + 1];
        const blue = grayscale ? row[index] : row[index + 2];
        const alpha = header.colorType === 4
          ? row[index + 1] / 255
          : header.colorType === 6
            ? row[index + 3] / 255
            : 1;
        const composedRed = red * alpha + 255 * (1 - alpha);
        const composedGreen = green * alpha + 255 * (1 - alpha);
        const composedBlue = blue * alpha + 255 * (1 - alpha);
        const luminance = (
          0.2126 * composedRed +
          0.7152 * composedGreen +
          0.0722 * composedBlue
        ) / 255;
        luminanceTotal += luminance;
        darkPixels += luminance <= darkPixelThreshold ? 1 : 0;
        sampledPixels += 1;
      }
    }
    previous = row;
  }

  return {
    darkPixelPercentage: Number(((darkPixels / sampledPixels) * 100).toFixed(4)),
    darkPixelThreshold,
    height: header.height,
    luminance: Number((luminanceTotal / sampledPixels).toFixed(6)),
    sampledPixels,
    samplingStep,
    totalPixels,
    width: header.width
  };
}

function domTextFacts(value = "", maximumLength = 1200) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return {
    domTextLength: text.length,
    domTextSummary: text.length > maximumLength
      ? text.slice(0, maximumLength - 1).trimEnd() + "…"
      : text
  };
}

function agentPreviewBrowserWorkerSource({
  contractVersion = "1",
  controlHealthFailureLimit = 4,
  controlHealthIntervalMs = 15_000,
  identityControlPath = "",
  idleTimeoutMs = 5 * 60 * 1000,
  playwrightModulePath = "",
  playwrightProjectRoot = "",
  suspendAfterMs = 30_000
} = {}) {
  return `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { inflateSync } from "node:zlib";

const socketPath = String(process.argv[2] || "").trim();
const metadataPath = String(process.argv[3] || "").trim();
const controlSocketPath = String(process.argv[4] || "").trim();
const workerToken = String(process.env.VIBE64_PREVIEW_BROWSER_WORKER_TOKEN || "").trim();
const controlToken = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_TOKEN || "").trim();
const controlGeneration = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_GENERATION || "").trim();
const sessionId = String(process.env.VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID || "").trim();
const executionId = String(process.env.VIBE64_EXECUTION_ID || "").trim();
const playwrightModulePath = ${JSON.stringify(String(playwrightModulePath || ""))};
// Without a pinned Playwright module, the project's own Playwright is used,
// or else the Playwright installed on this computer.
const playwrightProjectRoot = ${JSON.stringify(String(playwrightProjectRoot || ""))};
const identityControlPath = ${JSON.stringify(String(identityControlPath || ""))};
const contractVersion = ${JSON.stringify(String(contractVersion || "1"))};
const idleTimeoutMs = ${Number(idleTimeoutMs) || 5 * 60 * 1000};
const suspendAfterMs = ${Number(suspendAfterMs) || 30_000};
const requestLimitBytes = 1024 * 1024;
const controlHealthIntervalMs = ${Number(controlHealthIntervalMs) || 15_000};
const controlHealthFailureLimit = ${Number(controlHealthFailureLimit) || 4};

if (!socketPath || !metadataPath || !controlSocketPath || !workerToken || !controlToken || !controlGeneration || !sessionId || !executionId || !(playwrightModulePath || playwrightProjectRoot) || !identityControlPath) {
  process.stderr.write("Vibe64 managed browser worker configuration is incomplete.\\n");
  process.exit(64);
}

const computerPlaywrightModulePath = ${computerPlaywrightModulePath.toString()};
function loadPlaywright() {
  if (playwrightModulePath) return createRequire(import.meta.url)(playwrightModulePath);
  try {
    return createRequire(path.join(playwrightProjectRoot, "package.json"))("playwright");
  } catch (error) {
    const computerModule = error?.code === "MODULE_NOT_FOUND"
      ? computerPlaywrightModulePath(process.env.PATH, { existsSync, realpathSync }, path) : "";
    if (!computerModule) throw error;
    return createRequire(import.meta.url)(computerModule);
  }
}
const { chromium, request } = loadPlaywright();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const documentReadyForScreenshot = ${documentReadyForScreenshot.toString()};
const pngVisualMetrics = ${pngVisualMetrics.toString()};
const domTextFacts = ${domTextFacts.toString()};
${WORKER_STATE_SOURCE}${WORKER_COMMANDS_SOURCE}`;
}

export {
  agentPreviewBrowserWorkerSource
};
