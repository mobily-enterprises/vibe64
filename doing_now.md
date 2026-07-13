
  1. Stabilize server terminal plumbing first (no behavior changes)

  - Slice 1: add terminal inventory/drift test.
  - Why: catches new terminal surfaces immediately and prevents silent wiring drift.
  - Scope: public repo only.

  2. Add shared terminal access helper

  - Slice 2: createOwnedTerminalAccessors in packages/studio-terminal-core.
  - Why: removes repeated read/close/subscribe/write/resize wrapper duplication.
  - Scope: public repo only, tiny API addition.

  3. Add shared service-owned terminal route helper

  - Slice 3: registerServiceOwnedTerminalRoutes in packages/vibe64-core + exports + metadata + tests.
  - Why: one normalized route family for service-owned job terminals.
  - Scope: public repo only.

  4. Migrate the proof case only

  - Slice 4: deployment publish in vibe64-online (accessors + route wiring only).
  - Why: validates the helper chain end-to-end without touching codex/launch/shell semantics.
  - Scope: private online repo only.

  5. Then start the unified client terminal element work

  - Extract one canonical client terminal host/controller first:
      - shared terminal Vue component + controller contract
      - transport driver abstraction for websocket/input/resize

  - Migrate one provider at a time to this host (deployment publish is a good first target), then command terminals, then others.
  - Keep Codex/FixCodex as “special sessions” that still use the same UI host.

  6. Keep the boundary explicit

  - The common terminal UI layer only owns:
      - websocket lifecycle
      - xterm + key handling
      - resize contract
      - transcript display policies

  - Provider layers own:
      - start command/endpoint
      - auth namespace
      - lifecycle side-effects and recovery semantics

  Suggested immediate answer to your team now:
  start with slices 1 → 2 → 3 → 4 in that order, then begin unified client terminal extraction once those slices are green.

  If you want, I can have the agent start exactly at Slice 1 with a strict “files-by-files” scope and stop after each slice.


