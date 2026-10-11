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
individual function. Vibe64 does not generate competing file/subsystem summaries.

Genesis requires exactly one `- Main: \`project/relative/source\`` bullet in each
Program's **Sources**. An agent must inspect the implementation and choose it
explicitly. After updating the documents, use **Re-scan project**. An older
cached index without an anchor links to the Program document until re-scanned;
the viewer never guesses a main file.

Select a callable declaration, then choose **Explain function** for a short purpose
statement followed by function-specific steps through the existing Helper. Merely
opening a file or selecting a signature makes no Helper query. The explanation
describes meaningful decisions, data flow,
effects and failures in English. **Code** displays that declaration's exact source
range. Components, values and types offer Code; generated
function explanations are unavailable for non-callable declarations. **Code · whole file** opens the
existing source view; **Interface** returns to declarations. Controls work on
both desktop and mobile.

Pseudocode requests obey the existing account, access, admission and cancellation
rules. If the Helper is unavailable, saved explanations, Program and Code remain readable.
The explanation panel retains **Stop**, retry and follow-up controls. A completed
initial function answer is cached privately against actual saved source, account,
verified Helper profile and prompt revision. It remains informational and is
not supplied to coding agents. Source changes mark it stale; the next explicit
**Explain function** request regenerates it. **Regenerate explanation** forces a new request.
Follow-up chats do not replace the cached initial answer. Existing general
**Explain file or selection** in the Code editor remains available separately.

An out-of-date index disables symbol-range use. **Re-scan project** rebuilds
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
not determine the symbol explanation. Missing or invalid analysis offers
**Re-scan project**; oversized analysis retains Code and ordinary selection
explanations. Binary/download-only files retain their normal preview/download
controls.

Colleague can explain these steps and offer supported navigation. It cannot read
source text or request source investigation through usage knowledge; such work
belongs to the coding conversation and its existing authorized operations.

Vue single-file components expose a **default component** interface even when
they use script setup or contain only a template. Its **Code** covers the complete
component declaration. Explicit functions and other public declarations remain
available according to the selected language analysis.

From Architecture, enter a subsystem and scroll to its graphical files. Click or tap a
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
The file view keeps this secondary information collapsed. A missing Program
shows one short notice. **Code** and saved function explanations remain available
independently.
