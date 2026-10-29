// The update probe's head read for a GitHub repository: one Git protocol v2
// `ls-refs` request that answers what `git ls-remote <url> <refs...>` prints
// for those refs, with no Git, managed job or other process. Only
// https://github.com is asked, the one host Vibe64's Git credential helper
// gives a GitHub token to; the token goes only into this request's
// Authorization header.
const GITHUB_ORIGIN = "https://github.com";
// A listing of a few named branches is a few hundred bytes.
const MAX_LISTING_BYTES = 1024 * 1024;
const FLUSH_PACKET = "0000";
const DELIMITER_PACKET = "0001";

// Git sends a github.com request through https_proxy, else all_proxy (either
// case). Node's fetch uses HTTPS_PROXY only when the server started with
// NODE_USE_ENV_PROXY=1, and never ALL_PROXY. Where it would not take the proxy
// Git takes, the heads are read with Git; this is decided before any read.
function fetchReachesGithubAsGit(env = process.env) {
  const setting = (name) => String(env[name.toLowerCase()] || env[name] || "").trim();
  if (setting("HTTPS_PROXY")) return String(env.NODE_USE_ENV_PROXY || "").trim() === "1";
  return !setting("ALL_PROXY");
}

function remoteHeadsError(message, code, details = {}) {
  return Object.assign(new Error(message), { code, ...details });
}

function githubHttpsRemote(remoteUrl = "") {
  let url;
  try {
    url = new URL(String(remoteUrl || ""));
  } catch {
    return false;
  }
  return url.origin === GITHUB_ORIGIN && !url.username && !url.password && !url.search && !url.hash &&
    /^\/[^/]+\/[^/]+$/u.test(url.pathname.replace(/\/+$/u, ""));
}

function packetLine(text) {
  const payload = Buffer.from(text, "utf8");
  return Buffer.concat([Buffer.from((payload.length + 4).toString(16).padStart(4, "0"), "ascii"), payload]);
}

function lsRefsRequestBody(refs = []) {
  return Buffer.concat([
    packetLine("command=ls-refs\n"),
    Buffer.from(DELIMITER_PACKET, "ascii"),
    ...refs.map((ref) => packetLine(`ref-prefix ${ref}\n`)),
    Buffer.from(FLUSH_PACKET, "ascii")
  ]);
}

function invalidListing() {
  return remoteHeadsError("The repository returned invalid branch evidence.", "vibe64_session_update_refs_invalid");
}

// `<object-id> <refname>[ <attribute>...]` lines, ended by a flush packet.
function parseLsRefsResponse(bytes) {
  const listing = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const length = bytes.toString("ascii", offset, offset + 4);
    const size = Number.parseInt(length, 16);
    if (!/^[0-9a-f]{4}$/u.test(length) || (size > 0 && size < 4)) throw invalidListing();
    if (size === 0) return listing;
    if (offset + size > bytes.length) throw invalidListing();
    const line = bytes.toString("utf8", offset + 4, offset + size).replace(/\n$/u, "");
    offset += size;
    if (line.startsWith("ERR ")) {
      throw remoteHeadsError(`The project's repository refused the branch read: ${line.slice(4).trim()}`,
        "vibe64_session_update_check_failed");
    }
    const [head, ref] = line.split(" ");
    if (!head || !ref) throw invalidListing();
    listing.push({ head, ref });
  }
  throw invalidListing();
}

async function readBoundedBody(response) {
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body || []) {
    total += chunk.length;
    if (total > MAX_LISTING_BYTES) {
      await response.body.cancel().catch(() => {});
      throw invalidListing();
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function failedStatusError(status) {
  if (status === 401) {
    return remoteHeadsError("GitHub did not accept the signed-in account for this repository.",
      "vibe64_session_update_authentication_failed", { authenticationRejected: true });
  }
  if (status === 403 || status === 404) {
    return remoteHeadsError("GitHub did not let the signed-in account read this repository.",
      "vibe64_session_update_check_failed");
  }
  return remoteHeadsError(`GitHub answered the repository check with HTTP ${status}.`,
    "vibe64_session_update_check_failed");
}

// Returns `[{ head, ref }]` for the refs GitHub lists under the requested
// prefixes; the caller keeps only exact names, as it does for `ls-remote`.
// The whole read, answer included, ends within `timeoutMs`.
async function listGithubRemoteHeads({
  fetch: fetchRemote = globalThis.fetch,
  refs = [],
  remoteUrl = "",
  timeoutMs,
  token = ""
} = {}) {
  if (!githubHttpsRemote(remoteUrl)) {
    throw remoteHeadsError("Only a https://github.com repository can be read without Git.",
      "vibe64_session_update_authority_unsupported");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("A GitHub head read needs a positive timeout.");
  }
  const authToken = String(token || "").trim();
  if (!authToken) {
    throw remoteHeadsError("GitHub authentication is not ready for this repository.",
      "vibe64_codex_git_command_github_auth_unavailable");
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchRemote(`${remoteUrl.replace(/\/+$/u, "")}/git-upload-pack`, {
      body: lsRefsRequestBody(refs),
      headers: {
        Accept: "application/x-git-upload-pack-result",
        Authorization: `Basic ${Buffer.from(`x-access-token:${authToken}`, "utf8").toString("base64")}`,
        "Content-Type": "application/x-git-upload-pack-request",
        "Git-Protocol": "version=2",
        "User-Agent": "git/vibe64"
      },
      method: "POST",
      // A redirect would change the method or carry the token elsewhere.
      redirect: "manual",
      signal
    });
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw failedStatusError(response.status);
    }
    if (!String(response.headers.get("content-type") || "").startsWith("application/x-git-upload-pack-result")) {
      await response.body?.cancel().catch(() => {});
      throw invalidListing();
    }
    return parseLsRefsResponse(await readBoundedBody(response));
  } catch (error) {
    if (signal.aborted) {
      throw remoteHeadsError(`The project's repository did not answer within ${Math.ceil(timeoutMs / 1000)} s.`,
        "vibe64_session_update_check_timed_out", { timedOut: true });
    }
    if (String(error?.code || "").startsWith("vibe64_")) throw error;
    throw remoteHeadsError("The project's repository could not be reached for its branch read.",
      "vibe64_session_update_check_failed");
  }
}

export {
  fetchReachesGithubAsGit,
  githubHttpsRemote,
  listGithubRemoteHeads
};
