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

Hosted repository settings can also specify whether GitHub Save permits direct
commits/pushes or requires pull requests. GitHub still enforces your repository
permissions and branch rules. A hosted development database scope change requires
the owner and no open sessions; it does not merge or restore database contents.

If a load or save fails, read its error, retry the read and inspect the saved state
before sending the change again. Disabled controls may reflect missing authority
or active work; changing pages does not bypass those restrictions.

Colleague can explain the current choices and open the relevant settings page.
When directly requested, it can read and change supported settings through the
same operations, preserving unrelated values. It must report unsupported choices
or permission failures accurately and offer the appropriate UI or owner handoff.
Asking how to change a setting does not authorize saving it.
