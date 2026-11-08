// Genesis rejects current-format Stack reads until the project itself repairs
// or decides a project-owned contract. These are declaration problems with an
// actionable Genesis message, not host failures: callers show the project as
// needing attention, keep chat available for the repair, and never choose a
// competing proposal on the project's behalf.
const GENESIS_STACK_CONTRACTS_INCOMPLETE = "STACK_PROJECT_CONTRACTS_INCOMPLETE";
const GENESIS_STACK_SECTION_AMBIGUOUS = "STACK_SECTION_AMBIGUOUS";
const PROJECT_CONTRACT_ATTENTION_CODES = Object.freeze([
  GENESIS_STACK_CONTRACTS_INCOMPLETE,
  GENESIS_STACK_SECTION_AMBIGUOUS
]);

function genesisProjectContractNeedsAttention(error) {
  return PROJECT_CONTRACT_ATTENTION_CODES.includes(String(error?.code || "").trim());
}

// Genesis cannot read a project file it reads for the AI: the Blueprint, any
// Stack section, the subsystem map, Program, collaboration, engineering, Agent
// Skills, or an agent integration file. Its message and details (path, line,
// observed text) say what to fix, and a project JSON file that does not parse
// arrives as a SyntaxError. Either way the project needs a repair, not the
// host, so an AI message still goes. Genesis's own Git, process and
// host-context failures are not project files.
const GENESIS_STACK_PATH = "genesis/stack.md";
const GENESIS_HOST_FAILURE_PREFIXES = Object.freeze(["GIT_", "PROCESS_", "HOST_CONTEXT_"]);

function genesisProjectFileUnreadable(error) {
  if (error instanceof SyntaxError) return true;
  if (error?.name !== "GenesisError") return false;
  return !GENESIS_HOST_FAILURE_PREFIXES.some((prefix) => String(error.code).startsWith(prefix));
}

/**
 * Genesis's explanation with the file, the line and the text it found there, when it knows them.
 * Genesis numbers Stack lines within the failing section.
 * @param {Error & { details?: { path?: string, line?: number, observed?: string } }} error
 */
function genesisProjectFileDiagnostic(error) {
  const { path: file = "", line, observed } = error.details || {};
  const lineText = Number.isSafeInteger(line) ? ` (line ${line}${file === GENESIS_STACK_PATH ? " of its section" : ""})` : "";
  const where = file && (lineText || !error.message.includes(file)) ? `${file}${lineText}: ` : "";
  const found = typeof observed === "string" ? ` Found: "${observed}".` : "";
  return `${where}${error.message}${found}`;
}

export {
  GENESIS_STACK_PATH,
  GENESIS_STACK_SECTION_AMBIGUOUS,
  genesisProjectContractNeedsAttention,
  genesisProjectFileDiagnostic,
  genesisProjectFileUnreadable
};
