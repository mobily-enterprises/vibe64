// When a session's Preview starts by itself, and the per-tab record that keeps
// a recent automatic attempt from starting it again too soon.
import { stableLocalStorageKeyPart } from "@/lib/browserLocalStorage.js";
import { browserSessionStorage } from "@/lib/browser.js";

const AUTO_START_ATTEMPT_COOLDOWN_MS = 7000;
const AUTO_START_STABILITY_DELAY_MS = 750;

function shouldScheduleLaunchAutoStart({
  autoStartKey = "",
  externalBusy = false,
  key = "",
  loading = false,
  operationBusy = false,
  sessionLaunchable = true,
  sessionId = "",
  stoppedIntent = false,
  target = null,
  terminalDisplayed = true,
  terminalVisible = false
} = {}) {
  return Boolean(
    sessionId &&
    sessionLaunchable &&
    !stoppedIntent &&
    target &&
    target.available !== false &&
    key &&
    !externalBusy &&
    !loading &&
    !terminalVisible &&
    !operationBusy &&
    terminalDisplayed &&
    autoStartKey !== key
  );
}

function autoStartOutputsLoading({
  outputTargetsLoading = false,
  outputTargetsSettled = false
} = {}) {
  return Boolean(outputTargetsLoading || !outputTargetsSettled);
}

function launchAutoStartAttemptStorageKey(key = "") {
  const normalized = String(key || "").trim();
  return normalized ? `vibe64:launch-auto-start:${stableLocalStorageKeyPart(normalized)}` : "";
}

function readLaunchAutoStartAttemptCooldown(key = "", {
  now = Date.now(),
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return 0;
  }
  try {
    const record = JSON.parse(storage.getItem(storageKey) || "null");
    const startedAt = Number(record?.startedAt || 0);
    if (String(record?.key || "") !== String(key || "") || !Number.isFinite(startedAt) || startedAt <= 0) {
      clearLaunchAutoStartAttempt(key, { storage });
      return 0;
    }
    const remainingMs = AUTO_START_ATTEMPT_COOLDOWN_MS - (Number(now) - startedAt);
    if (remainingMs <= 0) {
      clearLaunchAutoStartAttempt(key, { storage });
      return 0;
    }
    return remainingMs;
  } catch {
    clearLaunchAutoStartAttempt(key, { storage });
    return 0;
  }
}

function writeLaunchAutoStartAttempt(key = "", {
  now = Date.now(),
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return false;
  }
  try {
    storage.setItem(storageKey, JSON.stringify({
      key: String(key || ""),
      startedAt: Number(now)
    }));
    return true;
  } catch {
    return false;
  }
}

function clearLaunchAutoStartAttempt(key = "", {
  storage = browserSessionStorage()
} = {}) {
  const storageKey = launchAutoStartAttemptStorageKey(key);
  if (!storageKey || !storage) {
    return;
  }
  try {
    storage.removeItem(storageKey);
  } catch {
    // Browser storage can be unavailable in private or constrained contexts.
  }
}

export {
  AUTO_START_ATTEMPT_COOLDOWN_MS,
  AUTO_START_STABILITY_DELAY_MS,
  autoStartOutputsLoading,
  clearLaunchAutoStartAttempt,
  launchAutoStartAttemptStorageKey,
  readLaunchAutoStartAttemptCooldown,
  shouldScheduleLaunchAutoStart,
  writeLaunchAutoStartAttempt
};
