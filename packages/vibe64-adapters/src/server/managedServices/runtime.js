import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  VIBE64_NIXPKGS_PIN,
  runtimePackage
} from "@local/vibe64-core/server/runtimeToolchain";

const MANAGED_SERVICE_DIRECTORY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;

function managedServiceRuntimeRoot({
  serviceDataRoot = "",
  serviceDirectory = ""
} = {}) {
  const root = normalizeText(serviceDataRoot);
  if (!root) {
    return "";
  }
  const directory = normalizeText(serviceDirectory);
  if (!MANAGED_SERVICE_DIRECTORY_PATTERN.test(directory)) {
    throw vibe64Error(
      "Managed service runtime directory is invalid.",
      "vibe64_managed_service_runtime_directory_invalid"
    );
  }
  return path.join(path.resolve(root), directory);
}

async function readManagedServiceSecret(filePath = "", {
  label = "Managed service"
} = {}) {
  const secretPath = normalizeText(filePath);
  if (!secretPath) {
    throw vibe64Error(
      `${label} secret path is unavailable.`,
      "vibe64_managed_service_secret_path_missing"
    );
  }
  const secret = normalizeText(await readFile(secretPath, "utf8"));
  if (!secret) {
    throw vibe64Error(
      `${label} secret is empty.`,
      "vibe64_managed_service_secret_empty"
    );
  }
  return secret;
}

function managedServiceRuntimeNixRecord(runtimeId = "") {
  const entry = runtimePackage(runtimeId);
  if (!entry?.nix?.attr || !entry.nix.flakeRef || !entry.nix.pin) {
    throw vibe64Error(
      `Managed service runtime is not backed by a complete Nix catalog entry: ${normalizeText(runtimeId) || "(missing)"}.`,
      "vibe64_managed_service_runtime_catalog_invalid"
    );
  }
  return {
    attr: entry.nix.attr,
    flakeRef: entry.nix.flakeRef,
    nixpkgsPin: entry.nix.pin,
    rev: VIBE64_NIXPKGS_PIN.rev
  };
}

function managedServiceStateWriterShellLines() {
  return [
    "write_service_state() {",
    "  local temporary_metadata_file=\"$metadata_file.next.$$\"",
    "  printf '%s' \"$1\" > \"$temporary_metadata_file\"",
    "  chmod 600 \"$temporary_metadata_file\"",
    "  mv -f \"$temporary_metadata_file\" \"$metadata_file\"",
    "}"
  ];
}

export {
  managedServiceRuntimeNixRecord,
  managedServiceRuntimeRoot,
  managedServiceStateWriterShellLines,
  readManagedServiceSecret
};
