# Read file interfaces and exact code

Open **Dashboard → Files → Repo**, then select a source file. The default view is
**Interface**, showing **File exports** available from the
project's selected language parser. Visibility follows that language's conventions.
Callable signatures show indexed parameters and return information when available.
The view explains that definitions can be operations, components, values or types.
File exports are not automatically the subsystem's intended API. Select a
definition to read its details.
Unrecorded return information is omitted; this does not mean a function returns
nothing. Coverage is partial; an empty list does not prove there is no public interface.
For Python, a static `__all__` list determines module exports. Dynamic or
conditional exports leave coverage partial and use naming conventions; review
the analysis warning rather than treating the list as complete.
Public values, properties, types and callables follow the selected language's
declarations. For example, a Rust item declared `pub(crate)` displays **Visibility:
crate**; it is available within that scope, not an unrestricted external API.
Symbol **Code** retains declaration keywords, modifiers, decorators and attached
attributes. A grouped declaration can include more than one named value. Build
configuration, macro expansion and conditional compilation remain outside static
coverage; use the project's declared preparation/verification for runtime proof.

**Part of …** links a supporting file to its Program's main source file. The
browser does not repeat the explanation in supporting files. **← Back** restores
the file you came from. Shared files can belong to several Programs; expand
**Part of … Programs** to choose a link when there are several memberships.

Main file icons have a gold border, star and **Main · …** label. In that file's
interface, expand its **Main** Program title to read the authored explanation,
contract and participating files. **Read Program** opens the Genesis document;
use **Dashboard → Files → Repo** to edit it. The Architecture viewer is read-only.
The anchor is the place to start reading, not necessarily an executable entry
point. It belongs to the Program's owning subsystem; supporting files may be
shared libraries elsewhere. These explanations describe the capability, not each
individual function. The **Explanation** field provides a separate, informational overview of
the saved file; it does not edit Genesis Program or subsystem responsibilities.

Genesis requires exactly one `- Main: \`project/relative/source\`` bullet in each
Program's **Sources**. An agent must inspect the implementation and choose it
explicitly. After updating the documents, use **Re-scan project**. An older
cached index without an anchor links to the Program document until re-scanned;
the viewer never guesses a main file.

The file opens as a document, with an **Explanation** field above its exports.
An empty field offers **Generate explanation**. Press it to fill the field through
the configured Helper. Saved text is shown automatically when you reopen the file;
**Update explanation** replaces it with a newly generated answer. Existing text
stays readable while an update runs. A short status marks an out-of-date answer.
These explanations describe the saved file, not a chat transcript or an authored
Genesis Program. A file explanation needs no project index.
Generated explanations lead with **Inputs** and **Outputs and use**: what callers
pass, what they receive, and which returned data or operations they read or invoke.
Required options, important defaults, live state, snapshots, awaitable results and
side effects are distinguished when the supplied source establishes them. Missing
contracts remain explicit. Press **Update explanation** to refresh an older answer
marked out of date after this guidance change.

Select a callable signature to reveal its **Pseudocode** field directly beneath
that signature. **Generate pseudocode** fills it with a purpose statement and
English steps. The Helper is asked for a short purpose sentence, the same input
and practical-output sections, then up to twelve concise steps, grouping related
operations in large declarations.
A saved answer appears when that declaration is selected;
**Update pseudocode** regenerates it. **Code** shows the exact declaration; **Pseudocode** returns to saved steps without generating again.
Components, values and types offer Code without an inapplicable pseudocode field.
**Code · whole file** opens the source view; **Interface** returns to the document.
The Architecture reader's source view uses the full width without an explanation
chat dock. Discussion belongs in the project's agent conversation.
Opening a file or selecting a signature makes no Helper query.

Both generated fields use the existing private source-editor cache, keyed to saved
source, person, project/session, verified Helper profile and prompt revision.
Source changes mark the text out of date. It remains informational and is not
supplied to coding agents. Generating or updating starts only on an explicit
button press. A missing Helper disables generation, but saved text and Code stay
readable. Configure the Helper in **Model routing** and connect its account in
**AI Accounts** if necessary.

While generating, the field shows **Generating explanation…**, **Stop**, and any
actual Helper progress. No transcript, user prompt or follow-up composer appears
in the document. Stopping or a failure retains earlier saved text and offers
**Retry**. To discuss the code, use the coding agent or a temporary conversation.
The Code editor's existing **Explain file or selection** conversation remains a
separate facility. A file explanation receives the complete saved source when it
fits the 60,000-character input limit; larger files use an explicitly labelled
bounded excerpt. Indexed function pseudocode uses the complete validated declaration
within that same character limit, including functions longer than 240 lines.

An out-of-date index disables symbol-range use. **Architecture → ⋯ → Re-scan project** rebuilds
the whole project browsing index: signatures, imports and UI links. It reads existing
Genesis documents; it does not rewrite Program or ask the Helper for explanations.
The running stage and elapsed seconds show progress, with **Cancel analysis** in
Architecture. An inspector failure offers **Command output** inline and retains
the preceding index. Fix the reported command or prepare the missing dependency,
then retry. **Code · whole file** and authored Program context remain
available without a supported parser. Unsaved edits disable generated
explanations and indexed range use until saved. Save with the existing **Save now**
control; conflicts retain the existing draft and recovery workflow. A source change
between selection and explanation is rejected rather than describing the wrong
range. For a symbol, the server resolves its indexed identity and checks that
declaration against the saved file; browser-supplied selection coordinates do
not determine the symbol explanation. Missing or invalid analysis points to the
Architecture menu; no file button scans the project. Oversized analysis retains
Code and ordinary selection
explanations. Binary/download-only files retain their normal preview/download
controls.

Colleague can explain these steps and offer supported navigation. It cannot read
source text or request source investigation through usage knowledge; such work
belongs to the coding conversation and its existing authorized operations.

Vue single-file components expose a **default component** interface even when
they use script setup or contain only a template. Its **Code** covers the complete
component declaration. Explicit functions and other public declarations remain
available according to the selected language analysis.

From Architecture, enter a subsystem and use its **Files** shortcut to reach the graphical files. Click or tap a
file icon once or press Enter to open only that file inside the
subsystem square. Selecting a subsystem public signature goes directly to its
implementation file and selects that exact declaration, including a resolved
re-export's original implementation. The same interface and explanation service
is used; there is no project-wide folder tree, Open file or Find in files in
this file view. Whole-file Code is read-only. A mouse wheel, two-finger touchpad
movement or a one-finger phone swipe scrolls the file, even at a scroll boundary.
Scroll out on the canvas outside the square, or Ctrl-scroll/pinch anywhere, to
return to its file icons. Outward zoom never opens a file. **×** at the top right
or Esc goes back one level. The subsystem breadcrumb returns to its retained interface and file browser;
**Engine** to the retained map. Use Dashboard Files for editing and project-wide
browsing. A stale, ambiguous or unavailable implementation identity never
selects a guessed declaration.

After following a cited source to another file, **← Back** restores the previous
file and selected declaration. This history also covers links across subsystems;
**×**, Esc and the subsystem breadcrumb return to the enclosing browser instead.

**Analysis details** holds coverage, visibility and missing-Helper information.
The file view keeps this secondary information collapsed. Program diagnostics remain inside **Analysis details**. **Code** and saved function explanations remain available
independently.
