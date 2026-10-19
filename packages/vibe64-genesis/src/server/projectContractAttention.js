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

export {
  GENESIS_STACK_CONTRACTS_INCOMPLETE,
  GENESIS_STACK_SECTION_AMBIGUOUS,
  genesisProjectContractNeedsAttention
};
