# Conversation-runtime extraction requirements

Moved from `AGENTS.md`. The general **Ownership Extractions** rules there still
apply; this extraction must also meet all seven requirements below.

1. Inventory original functions, callers, state and tests before editing; mark
   each behavior as moving, staying application-owned, or becoming a host facility.
   Admission, checkpoints, Git, worktrees, attachment storage, renewal UX and
   Senior/Junior orchestration remain Vibe64 responsibilities.
2. Define the session-store, managed-execution, Genesis-shim and provider-selection
   cut lines. Prefer existing small facilities such as `host.execution` and
   `host.commandWrapper`. JSKIT imports no Vibe64 or Genesis; standalone defaults
   must work without them. Do not replace imports with a large callback bag.
3. Preserve Codex's shared app-server per account/runtime isolation scope.
   Conversations own threads, not one server each. Preserve independent stop,
   account/helper-token refresh, process identity, locks, socket limits, hook trust
   and recovery. Any host scope choice uses the same implementation.
4. Move Colleague onto the extracted backend through its common API. Preserve its
   conversation identity and existing storage upgrade.
5. Retain genuinely new direct-API, local-execution, file-storage, application-tool
   and storage-contract facilities that have no Vibe64 counterpart.
6. Verify the frozen baseline and WIP local Git references before extraction.
   Preserve unrelated work and staging; do not reset or publish the WIP refs.
7. Compare original and moved behavior for shared reuse, independent stop,
   account refresh, restart and recovery. Move original tests for the other cases;
   do not weaken their assertions or duplicate the full suite.
