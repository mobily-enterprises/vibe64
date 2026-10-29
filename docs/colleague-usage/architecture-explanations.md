# Where Architecture explanations come from

Architecture displays project documentation, analysed source facts and optional
AI interpretations. They have different owners and update rules.

| What you read | Who creates it | Owner and storage | How it changes |
| --- | --- | --- | --- |
| Subsystem explanation | A coding agent following Genesis guidance, with human review | Genesis project documentation: the responsibility prose in `genesis/subsystems.md` | An explicit documentation/adoption task reconciles it with the source and current directory boundaries. |
| Program explanation | A coding agent following Genesis guidance, with human review | Genesis project documentation under `genesis/program/`; the subsystem map assigns each Program exactly once | An explicit Program task updates the purpose, contract, main source and supporting sources together. |
| File Explanation | The **Explain & check** model, when the person requests it | Vibe64 source-editor informational cache in private runtime state | **Generate explanation** creates it; **Update explanation** refreshes it. |
| Function Pseudocode | The **Explain & check** model, when the person requests it | The same Vibe64 cache, tied to the exact indexed declaration | **Generate pseudocode** or **Update pseudocode** reads the saved declaration and fills the field. |
| Signatures, imports and ownership links | Genesis's source index and selected language/framework/package analysers | Derived index facts, including the replaceable `.genesis/` snapshots | **Architecture options → Re-scan project** recomputes facts. It does not ask an AI to write explanations. |

Interface group definitions are shared UI guidance, not generated explanations
or findings about a particular subsystem. **Declared API** means explicit package
or module exports, including declarations with no observed consumers. **Imported
by other subsystems** identifies the particular declarations evidenced across a
directory boundary. **Exports from externally used files** have file-level boundary evidence
without proven imports of those individual exports. **Other available exports**
follow the language's visibility rules without deciding intended API membership.
Expand an import count beneath a signature to see the importing source paths;
select a path to read it and use Back to return. File-level candidates label their
evidence **Source file imported by** to avoid claiming a particular export is used.
Hover the group title for its definition; the Partial badge and File exports heading
carry their coverage explanation on hover. **Analysis details** shows actual
diagnostics and coverage limits; unknown return information is omitted.

## Subsystems and Programs

A subsystem owns one project-relative directory. A more specific nested owner
owns its files. Its responsibility is a substantive explanation of purpose,
scope, important parts and cooperation with other owners. The circle uses a
shortened display; the square shows the authored text. Shortening a display does
not replace the stored explanation.

Choosing the subsystems is a design judgment by the person and coding agent,
guided by source evidence and Genesis's authoring instructions. They explicitly
record each id, name, responsibility and directory in the canonical map. Stack
directory-parent rules are adoption hints, not an alternative catalogue.

File membership is then computed by Genesis's index: the most specific declared
directory containing the file is its owner. The parent owns the remaining files.
Every indexed source must be covered, including unsupported languages and support
files; a project-root owner can cover the remainder. Vibe64 does not infer ownership
from imports, file names, UI participation or the layout of circles.

A Program explains a meaningful capability. It has one subsystem owner and one
explicitly designated main source in that owner's directory. Supporting files
can include another subsystem's libraries and can participate in several Programs.
Program document folders and source-list order never decide ownership or the main
file. Sources are a useful implementation map rather than every incidental helper.

Select a Program in the subsystem to read its dedicated Architecture view.
Its opening preview stays short; **Read full explanation** opens the complete
authored text in a separate scrollable dialog, full-screen on phones. **×** or Esc
closes that dialog without going back or changing the source list.
**Main source file** opens the anchor through the shared Files viewer/editor.
**Supporting files** reaches the associated source icons. **← Back**, **×** and
Esc return through Program and source navigation. File membership links return
to the Program view. These controls never open raw Genesis documentation files.

Genesis supplies the grammar, prompts, validation and common facts. It does not
run an AI to author these explanations. The coding agent performs that work in
the project's ordinary source changes; the person can review and correct them
before saving. A regenerated map must reconcile responsibilities, memberships
and required main sources against the new directory owners. Architecture reads
the resulting canonical list without another catalogue or hardcoded owner names.

Documentation is fallible. A valid source citation or main anchor proves that the
declared location exists and has the required owner; it does not prove the prose
is up to date. Source changes do not silently rewrite authored responsibilities
or Program contracts. Request a focused reconciliation when behavior or boundaries
change, then re-scan to load the updated facts.

## File and function interpretations

Opening a file, signature, subsystem or Program starts no explanation query.
The source-editor service admits an explicit request using current project/session
access, saved source and the **Explain & check** model. A file request asks for scope,
responsibilities and behavior. An indexed callable request asks for practical
inputs, returned data or operations, and ordered pseudocode. It does not impose
function input/output sections on a file overview.

Saved interpretations are isolated by project/source, session and account scope.
Generation reuse checks source identity, range/declaration, presentation, guidance
revision and Helper execution profile. The fields compare saved source and guidance
with their records and mark changed results **Out of date**. Old text stays readable;
an explicit Update regenerates it. Merely reading a cached field makes no request.
Progress, Stop and failures belong to that one requested field.

These results are informational. They do not modify Genesis documents, declare an
intended API or enter the coding agent's context. Files and Architecture share the
same viewer, editor, save/conflict coordination and explanation service. Architecture
hides the file browser while reading a selected source; Files keeps full browsing.

Colleague can explain these controls and offer to delegate a documentation task
through its supported assignment actions. It does not acquire source-code access
from this guide. A coding agent needs the actual source and project guidance;
the person's accepted delegation remains required.
