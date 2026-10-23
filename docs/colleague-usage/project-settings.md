# Change project settings

Open the intended project and **Project settings** from its Dashboard. On mobile,
use **Show project**, select Dashboard, and use **Dashboard section** to find the
page. These settings apply to the selected project, not Colleague's model or a
running coding turn. Controls can be read-only when your role cannot change them.

Review the existing values before editing the offered collaboration, engineering,
prompt-suggestion or other project settings. Use the section's Save control and
wait for its saved result. Changes to collaboration style apply to future work;
they do not rewrite past messages. Engineering choices do not migrate existing
code automatically. Prompt suggestions can be changed separately from those choices.

**Connected projects** maintains the source-owned `vibe64.connections.json` list.
Add a name, GitHub URL and Dependency/Composition relationship.
Package type can inherit the Stack default or explicitly select npm (Node.js),
Composer (PHP), pip (Python), Bundler (Ruby), Go modules, Cargo (Rust), Maven,
Gradle, NuGet (.NET) or custom; it is independent of the relationship.
Custom requires a Preparation script path relative to this project, with its
runtime declared in Stack. Every other type disables and clears the script; the
project's own declared Verify command, not Vibe64, treats that source.
Use **Save connected projects** for the list; ordinary project Save pushes
that source edit. See **Configure connected projects** for access and recovery.

Hosted repository settings can also specify whether GitHub Save permits direct
commits/pushes or requires pull requests. GitHub still enforces your repository
permissions and branch rules. A hosted development database scope change requires
the owner and no open sessions; it does not merge or restore database contents.

With **One database shared by this project** selected, you can check **Allow
multiple sessions with this shared database**, then choose **Save database choice**.
The warning reads **All sessions will share the same database.** The checkbox and
warning appear only for that choice, on desktop and mobile. The override permits
the normal maximum of three open sessions. You can change it while sessions are
open. Turning it off preserves every existing session and its data; it blocks
additional sessions while one or more remain open. The New session control
updates after saving without reloading the page. Changing the database scope
itself still requires closed sessions. Colleague can explain or, when requested,
save this override through the same authorized settings action.

If a load or save fails, read its error, retry the read and inspect the saved state
before sending the change again. Disabled controls may reflect missing authority
or active work; changing pages does not bypass those restrictions.

Colleague can explain the current choices and open the relevant settings page.
When directly requested, it can read and change supported settings through the
same operations, preserving unrelated values. It must report unsupported choices
or permission failures accurately and offer the appropriate UI or owner handoff.
Asking how to change a setting does not authorize saving it.
