// Where a session command wrapper finds its control: the socket, session, token and generation (and contract
// version) its agent received in its environment, else the session's control file, whose path the wrapper is
// written with. A program the agent starts may run its own children with secret-looking variables blanked (a
// project's tests often blank every *_TOKEN) or with nothing but PATH; those children are still the session's, and
// the file names the same control the environment does. The server writes the file whenever it prepares the
// control, readable only by the account the session's commands run as, in the session's own helper directory beside
// the wrapper, so it reaches no process that could not already read that environment. The control checks the
// token, session and generation as before, whichever of the two named them.

import path from "node:path";
import { writeFileAtomic } from "@local/vibe64-atomic-file";

const AGENT_CONTROL_DIR_NAME = "controls";
const AGENT_CONTROL_IDENTITY_FIELDS = Object.freeze(["socketPath", "sessionId", "token", "generationId"]);

/**
 * The control file of one control ("git", "env", ...) in a session's helper directory.
 * @param {string} wrapperHostDir
 * @param {string} control
 */
function agentControlFilePath(wrapperHostDir, control) {
  return path.join(path.resolve(wrapperHostDir), AGENT_CONTROL_DIR_NAME, `${control}.json`);
}

/**
 * Writes a control's identity to its file, whole (a wrapper never reads half of one), readable only by this account.
 * @param {string} filePath
 * @param {{ socketPath: string, sessionId: string, token: string, generationId: string, contractVersion?: string }} identity
 */
async function writeAgentControlFile(filePath, identity) {
  await writeFileAtomic(filePath, `${JSON.stringify(identity)}\n`, { directoryMode: 0o700, durable: false, createMode: 0o600 });
}

/**
 * Wrapper source defining sessionControlIdentity(fromEnvironment): the identity the environment names when it names
 * all of it, else the control file's. The wrapper imports readFileSync from node:fs.
 * @param {string} controlFilePath "" for a wrapper written without one (it then reads the environment only)
 */
function agentControlIdentitySource(controlFilePath = "") {
  return `const sessionControlFile = ${JSON.stringify(String(controlFilePath || ""))};
// The environment the agent received names this session's control; a program it started may have blanked or dropped
// those variables for its own children, so the session's control file names the same one.
function sessionControlIdentity(fromEnvironment = {}) {
  const complete = (identity) => ${JSON.stringify(AGENT_CONTROL_IDENTITY_FIELDS)}
    .every((field) => typeof identity?.[field] === "string" && identity[field].trim() !== "");
  if (complete(fromEnvironment) || !sessionControlFile) return fromEnvironment;
  try {
    const saved = JSON.parse(readFileSync(sessionControlFile, "utf8"));
    return complete(saved) ? saved : fromEnvironment;
  } catch {
    return fromEnvironment;
  }
}
`;
}

/**
 * Wrapper source reading the identity a control's environment variables (<prefix>_SOCKET, _SESSION_ID, _TOKEN,
 * _GENERATION and _CONTRACT_VERSION) name, else its control file, into `const <name>`.
 * @param {{ controlFilePath?: string, envPrefix: string, name?: string }} options
 */
function agentControlEnvironmentIdentitySource({ controlFilePath = "", envPrefix, name = "controlIdentity" }) {
  const variable = (suffix) => `String(process.env.${envPrefix}_${suffix} || "").trim()`;
  return `${agentControlIdentitySource(controlFilePath)}const ${name} = sessionControlIdentity({
  socketPath: ${variable("SOCKET")},
  sessionId: ${variable("SESSION_ID")},
  token: ${variable("TOKEN")},
  generationId: ${variable("GENERATION")},
  contractVersion: ${variable("CONTRACT_VERSION")}
});
`;
}

export {
  agentControlEnvironmentIdentitySource,
  agentControlFilePath,
  agentControlIdentitySource,
  writeAgentControlFile
};
