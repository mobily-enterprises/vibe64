# @local/vibe64-system-graph

Active-session architecture browser for Vibe64. The package owns the checked-in current-state `vibe64.system.json` contract, Vibe64-owned System adapters, deterministic findings and projections, session-authorized APIs, and the interactive System client.

The first release registers only the JSKIT System adapter. Laravel, Next.js, and other project types remain explicitly unsupported until Vibe64 ships dedicated adapters for their conventions.

## Subsystem ownership contract

A subsystem is a stable semantic responsibility anchored to the physical source tree. It is not synonymous with a directory: one subsystem may span several files or directories, while a more specific nested subsystem may own part of a broader adapter-derived package.

Each subsystem carries:

- `anchors`: physical `file` or `directory` paths with an `owns`, `implements`, `supports`, or `configures` relation;
- `capabilities`: open-ended facts that the subsystem `provides` or `requires`, such as a web page, API operation, provider, workflow, or feature;
- provenance: `derived` adapter facts, `inferred` Codex proposals, or `declared` user meaning;
- workflow state: adapter facts are `current`, Codex proposals are `proposed`, and user declarations are `accepted` by default.

The exact same physical `owns` anchor cannot belong to two subsystems. Nested ownership is valid; the most-specific owner becomes a file's primary subsystem while broader and non-owning associations remain available.

The framework adapter owns only facts it can prove mechanically. The JSKIT adapter currently derives package boundaries, package capabilities and providers, registered API operations, the client-side `src/pages` subsystem, and its file-backed URLs. Codex may propose the responsibilities that require interpretation, but it does so through explicit declarations in the same checked-in `vibe64.system.json` current-state document. It does not mutate application source from the System view.

An inferred declaration can deliberately cross the directory tree:

```json
{
  "kind": "subsystem",
  "id": "codex:subsystem:session-experience",
  "title": "Session experience",
  "description": "Coordinates session state and its studio controls.",
  "executionSide": "client",
  "authoredBy": "codex",
  "origin": "inferred",
  "status": "proposed",
  "anchors": [
    { "kind": "directory", "path": "src/composables/vibe64-session", "relation": "owns", "origin": "inferred" },
    { "kind": "directory", "path": "src/components/studio/vibe64-session", "relation": "supports", "origin": "inferred" }
  ],
  "capabilities": [
    { "id": "session-workflow-ui", "kind": "workflow-ui", "direction": "provides", "title": "Session workflow UI", "origin": "inferred" }
  ]
}
```

The client renders these definitions as a semantic sky above File City. Selecting a subsystem always illuminates its owned files and directory terraces and reveals its evidence-backed ownership tethers. Dependency context is deliberately progressive: the optional Connections layer groups repeated use of the same imported export or injected token into one consistently thin line ending at the smallest common directory owned by the consuming subsystem. Its tone moves from gray toward charcoal as the hidden use count grows, encoding density without adding visual weight. Selecting that collection point expands amber last-mile lines to the exact consuming buildings without leaving subsystem mode. A subsystem with several owned physical pieces gets one line per piece; an unanchored scattered file gets its own file-level collection point, so a poor boundary remains visibly poor rather than being hidden behind one cloud. The inspector explains each collection and lets the user inspect an exact last-mile file in place. Raw file web preserves the complete building-to-building evidence as a separate explicit drill-down. The independent Libraries layer adds compact npm-package satellites and evidence drops to their importing files. All three layers default off. Node built-in modules are omitted because they are implementation details rather than architectural dependencies. The physical city remains authoritative; the sky explains why its code exists and what it relies on.

Subsystems can also express architectural strata without changing the generated directory tree. Double-clicking a subsystem cloud opens its physical-stratum control. The user chooses directly between five discrete layers: the generated baseline and four levels below it. Every directory terrace owned by that subsystem—and every scattered building primarily assigned to it—moves by the same amount. Each level is positioned cumulatively from the level above it. Its separation is at least 2.4 times the full height of the tallest skyline in that lower layer, with a larger minimum void when the layer is empty or contains only small buildings. The third layer therefore depends on the resolved position of the second rather than multiplying one fixed offset. File City creates a complete campus slab at every occupied stratum; subsystems assigned to the same depth share a visible architectural plane instead of floating independently in space. Nested directory elevation is retained inside each shifted piece, while a more-specific nested subsystem keeps its own independently chosen stratum. This makes foundational systems visibly lower without turning the city into a free-form scene editor.

The semantic circles follow the physical assignment. Baseline subsystems remain in the top semantic sky, while a subsystem on a lower layer gets its circle in that layer's void, just below the slab above. Circles only avoid other circles on the same physical level, so equivalent positions on separate levels remain vertically aligned. Ownership and dependency lines therefore stay local to the architecture instead of stretching from every lower layer back to the top sky.

Orbit framing is contextual rather than fixed to the midpoint of the complete vertical stack. An overview rotates around the horizontal centre of the active city layer, a focused file, directory, campus, or subsystem retains its own centre, and manually panning the scene moves the pivot with the camera target. Fitting or resetting the view restores the active layer's city-centred pivot. Lower-layer perspective cameras remain below the slab above them so the new pivot does not send the view through an opaque level.

Forward navigation follows the pointer rather than always collapsing into the centre of the screen. Wheel and vertical trackpad dolly use the cursor as their destination, including infinity dolly once the camera reaches its minimum orbit distance. Keyboard forward and backward controls translate both camera and target along the cursor ray, allowing continuous free-flight through the city while the orbit pivot travels with the walk instead of the orbit radius collapsing.

In Subsystems view, each ownership tether terminates at the base directory of one physical subsystem piece. Clicking any such base directory selects the subsystem exactly as clicking its cloud does. Descendant directories retain their ordinary directory inspection behavior, and a subsystem scattered across several owned directories exposes the same selection affordance at every piece.

The chosen depth is Vibe64 presentation metadata, not an adapter convention. It is stored as a `subsystem-depth` declaration in the same checked-in `vibe64.system.json` current-state document and survives later System refreshes. JSKIT, Laravel, Next.js, and future adapters only identify subsystem ownership; the shared File City contract applies the stratum consistently.

## Connection contract

Vibe64 owns one small, fixed connection vocabulary:

- `import`: a source file statically imports or re-exports a target file or package;
- `injection`: a source file consumes a container token that can be resolved to its registered owner;
- `declaration`: framework metadata declares a subsystem dependency without claiming a file-level call.

Adapters translate framework facts into these records; they do not provide renderers or invent connection kinds. Adding a genuinely new architectural paradigm requires a deliberate Vibe64 contract and renderer change. This keeps the model equally usable by future Laravel, Next.js, and other adapters without making the client understand JSKIT.

The JSKIT adapter mechanically translates static imports, package export maps, descriptor dependencies, literal `app.service` and `app.singleton` registrations, `scope.make` consumers, provider `static dependsOn` tokens, action dependency declarations, and descriptor container tokens. Unknown or ambiguous tokens remain external references. The inspector groups exact file pairs and lets each imported file expand to show the source path, target path, and statically selected exports.
