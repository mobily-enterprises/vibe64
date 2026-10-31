// The browser worker program's state: its browser, the process groups it
// started and tracks, its metadata file and the browser's lifecycle. Text of
// the program agentPreviewBrowserWorkerSource writes, not code run here.
const WORKER_STATE_SOURCE = `const state = Object.create(null);
let browser = null;
let context = null;
let page = null;
let previewUrl = "";
let previewInstance = "";
let applicationIdentity = null;
let commandQueue = Promise.resolve();
let closing = false;
let idleTimer = null;
let suspendTimer = null;
let controlHealthFailures = 0;
let shutdownPromise = null;
let browserProcessGroups = [];

function safeUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    if (url.searchParams.has("vibe64_preview_token")) {
      url.searchParams.set("vibe64_preview_token", "[redacted]");
    }
    return url.toString();
  } catch {
    return "";
  }
}

function redact(text = "") {
  return String(text || "")
    .replace(/(vibe64_preview_token=)[^&\\s]+/gu, "$1[redacted]")
    .split(previewUrl).join(previewUrl ? "[managed preview URL redacted]" : "");
}

function jsonValue(value) {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

// Linux reads /proc. Elsewhere ps reports the same fields; lstart becomes
// whole seconds since the epoch, as in runtime/processStart.js.
function psLines(args) {
  try {
    return execFileSync("ps", args, {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"]
    }).split(/\\r?\\n/u);
  } catch (error) {
    return String(error?.stdout || "").split(/\\r?\\n/u);
  }
}

function psIdentity(line) {
  const match = /^\\s*(\\d+)\\s+(\\d+)\\s+(\\S+)\\s+(\\S.*\\S)\\s*$/u.exec(String(line || ""));
  const startedAt = match ? Date.parse(match[4]) : Number.NaN;
  return Number.isFinite(startedAt)
    ? {
        groupId: Number(match[2]),
        parentId: Number(match[1]),
        startTimeTicks: String(Math.floor(startedAt / 1000)),
        state: match[3].slice(0, 1)
      }
    : null;
}

function processIdentity(pid) {
  if (process.platform !== "linux") {
    return psIdentity(psLines(["-o", "ppid=,pgid=,stat=,lstart=", "-p", String(pid)])[0]);
  }
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    const closeIndex = stat.lastIndexOf(") ");
    const fields = stat.slice(closeIndex + 2).trim().split(/\\s+/u);
    return {
      groupId: Number(fields[2]),
      parentId: Number(fields[1]),
      startTimeTicks: String(fields[19] || ""),
      state: String(fields[0] || "")
    };
  } catch {
    return null;
  }
}

// Every visible process with its identity, or null when the table is unreadable.
function processTable() {
  if (process.platform !== "linux") {
    const lines = psLines(["-ax", "-o", "pid=,ppid=,pgid=,stat=,lstart="]);
    const processes = [];
    for (const line of lines) {
      const match = /^\\s*(\\d+)\\s+(.*)$/u.exec(line);
      const identity = match && psIdentity(match[2]);
      if (identity) processes.push({ pid: Number(match[1]), ...identity });
    }
    return processes.length ? processes : null;
  }
  try {
    const processes = [];
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\\d+$/u.test(entry.name)) continue;
      const pid = Number(entry.name);
      const identity = processIdentity(pid);
      if (identity) processes.push({ pid, ...identity });
    }
    return processes;
  } catch {
    return null;
  }
}

function processGroupAlive(groupId) {
  if (!Number.isSafeInteger(groupId) || groupId <= 1) {
    return false;
  }
  const processes = processTable();
  if (processes) {
    return processes.some((entry) => entry.groupId === groupId && entry.state !== "Z");
  }
  try {
    process.kill(-groupId, 0);
    return true;
  } catch {
    return false;
  }
}

function normalizedBrowserProcessGroups(value = []) {
  const groups = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const groupId = Number(entry?.groupId);
    const startTimeTicks = String(entry?.startTimeTicks || "");
    if (Number.isSafeInteger(groupId) && groupId > 1 && startTimeTicks) {
      groups.set(groupId, { groupId, startTimeTicks });
    }
  }
  return [...groups.values()].sort((left, right) => left.groupId - right.groupId);
}

function metadataSignature(metadata = {}) {
  return crypto.createHash("sha256")
    .update([
      workerToken,
      String(metadata.contractVersion || ""),
      String(metadata.executionId || ""),
      String(metadata.pid || ""),
      String(metadata.socketPath || ""),
      String(metadata.startTimeTicks || ""),
      String(metadata.startedAt || ""),
      String(metadata.workerScriptPath || ""),
      JSON.stringify(normalizedBrowserProcessGroups(metadata.browserProcessGroups))
    ].join("\\n"))
    .digest("hex");
}

async function createWorkerMetadata() {
  const identity = processIdentity(process.pid);
  const metadata = {
    browserProcessGroups: [],
    contractVersion,
    executionId,
    pid: process.pid,
    socketPath,
    startTimeTicks: String(identity?.startTimeTicks || ""),
    startedAt: new Date().toISOString(),
    workerScriptPath: path.resolve(process.argv[1] || "")
  };
  metadata.signature = metadataSignature(metadata);
  const temporaryPath = metadataPath + "." + process.pid + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(metadata) + "\\n", { mode: 0o600 });
  await rename(temporaryPath, metadataPath);
}

async function writeWorkerMetadata() {
  let metadata;
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {
    return false;
  }
  if (
    Number(metadata?.pid) !== process.pid ||
    metadata?.socketPath !== socketPath ||
    metadata?.contractVersion !== contractVersion ||
    metadata?.signature !== metadataSignature(metadata)
  ) {
    return false;
  }
  const nextMetadata = {
    ...metadata,
    browserProcessGroups: normalizedBrowserProcessGroups(browserProcessGroups)
  };
  nextMetadata.signature = metadataSignature(nextMetadata);
  const temporaryPath = metadataPath + "." + process.pid + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(nextMetadata) + "\\n", { mode: 0o600 });
  await rename(temporaryPath, metadataPath);
  return true;
}

function descendantBrowserProcessGroups() {
  const processes = processTable();
  if (!processes) {
    return [];
  }
  const descendantIds = new Set([process.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of processes) {
      if (!descendantIds.has(entry.pid) && descendantIds.has(entry.parentId)) {
        descendantIds.add(entry.pid);
        changed = true;
      }
    }
  }
  // Group leaders come from the table already read, once per group.
  const processesById = new Map(processes.map((entry) => [entry.pid, entry]));
  const groups = new Map();
  for (const entry of processes) {
    if (!descendantIds.has(entry.pid) || entry.groupId === process.pid || groups.has(entry.groupId)) continue;
    const leader = processesById.get(entry.groupId);
    if (leader?.groupId === entry.groupId && leader.startTimeTicks) {
      groups.set(entry.groupId, {
        groupId: entry.groupId,
        startTimeTicks: leader.startTimeTicks
      });
    }
  }
  return normalizedBrowserProcessGroups([...groups.values()]);
}

function trackedProcessGroupAlive(entry = {}) {
  const groupId = Number(entry?.groupId);
  const identity = processIdentity(groupId);
  return Boolean(
    identity &&
    identity.groupId === groupId &&
    identity.startTimeTicks === String(entry?.startTimeTicks || "") &&
    processGroupAlive(groupId)
  );
}

// The tracked groups still alive. Where ps supplies the table, one read
// answers for every group.
function liveTrackedProcessGroups(groups = []) {
  if (process.platform === "linux") {
    return groups.filter(trackedProcessGroupAlive);
  }
  const processes = processTable() || [];
  const processesById = new Map(processes.map((entry) => [entry.pid, entry]));
  return groups.filter((entry) => {
    const groupId = Number(entry?.groupId);
    const leader = processesById.get(groupId);
    return Boolean(
      leader &&
      leader.groupId === groupId &&
      leader.startTimeTicks === String(entry?.startTimeTicks || "") &&
      processes.some((candidate) => candidate.groupId === groupId && candidate.state !== "Z")
    );
  });
}

async function terminateBrowserProcessGroups() {
  const groups = liveTrackedProcessGroups(normalizedBrowserProcessGroups(browserProcessGroups));
  for (const entry of groups) {
    try {
      process.kill(-entry.groupId, "SIGTERM");
    } catch {
      // The browser process group already exited.
    }
  }
  for (let attempt = 0; attempt < 20 && liveTrackedProcessGroups(groups).length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const entry of liveTrackedProcessGroups(groups)) {
    try {
      process.kill(-entry.groupId, "SIGKILL");
    } catch {
      // The browser process group exited before the fallback signal.
    }
  }
  browserProcessGroups = [];
  await writeWorkerMetadata().catch(() => false);
}

function statusPayload() {
  return {
    browserProcessGroupCount: browserProcessGroups.length,
    contractVersion,
    connected: Boolean(browser?.isConnected?.()),
    contextReady: Boolean(context),
    executionId,
    applicationIdentity,
    pageReady: Boolean(page && !page.isClosed()),
    pid: process.pid,
    previewInstance,
    started: Boolean(browser),
    url: safeUrl(page && !page.isClosed() ? page.url() : previewUrl)
  };
}

// Once no command has run for suspendAfterMs, the browser's process groups are
// stopped, so a page that animates or renders WebGL uses no CPU until the next
// command. Chromium's page freezing cannot do this here: Playwright keeps each
// page focused, which keeps it visible, and Chromium does not freeze a visible
// page.
function signalBrowserProcessGroups(signal) {
  for (const entry of normalizedBrowserProcessGroups(browserProcessGroups)) {
    const leader = processIdentity(entry.groupId);
    if (leader?.groupId !== entry.groupId || leader.startTimeTicks !== entry.startTimeTicks) {
      continue;
    }
    try {
      process.kill(-entry.groupId, signal);
    } catch {
      // The browser process group already exited.
    }
  }
}

async function closeBrowser() {
  // A stopped browser cannot answer Playwright's close request.
  signalBrowserProcessGroups("SIGCONT");
  const currentBrowser = browser;
  page = null;
  context = null;
  browser = null;
  applicationIdentity = null;
  previewInstance = "";
  previewUrl = "";
  if (currentBrowser) {
    await currentBrowser.close().catch(() => null);
  }
  await terminateBrowserProcessGroups();
}

async function ensureBrowser(url = "", {
  instance = "",
  reset = false
} = {}) {
  const requestedUrl = String(url || "").trim();
  const requestedInstance = String(instance || "").trim();
  if (!requestedUrl) {
    throw new Error("The managed preview URL is unavailable.");
  }
  if (
    reset ||
    !browser?.isConnected?.() ||
    !context ||
    !page ||
    page.isClosed() ||
    (requestedInstance && previewInstance && requestedInstance !== previewInstance)
  ) {
    await closeBrowser();
    try {
      browser = await chromium.launch({ headless: true });
      browserProcessGroups = descendantBrowserProcessGroups();
      await writeWorkerMetadata();
      context = await browser.newContext();
      page = await context.newPage();
      previewUrl = requestedUrl;
      previewInstance = requestedInstance;
      await page.goto(requestedUrl, {
        waitUntil: "load"
      });
    } catch (error) {
      await closeBrowser();
      error.code = error.code || "vibe64_managed_browser_navigation_failed";
      throw error;
    }
  }
  return statusPayload();
}

`;

export { WORKER_STATE_SOURCE };
