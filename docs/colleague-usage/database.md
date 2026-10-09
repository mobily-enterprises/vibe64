# Browse a project's Database

Open **Database** in the selected session's Dashboard. You need project access and
a configured database. On mobile, reveal the project and use **Dashboard section**;
**Back to dashboard** returns without requiring the database to finish loading.

Select **Overview**, **ERD** or **Data**. The selection stays in the URL across
navigation and reload. In Data, choose a listed table to inspect it. Returning to
a mounted table preserves its own draft and results; leaving or reloading the
workspace does not preserve an unsaved SQL draft. A loading or unavailable database
is not an empty successful query.

In **Overview**, select **Review N ungrouped tables** to ask the coding agent to
classify the tables currently under **Other tables**, including ones previously
reviewed. The request preserves existing groups and manual choices; the agent
can explain why some tables remain ungrouped. The control requires an available
coding assistant and submitting it starts that request. Colleague can explain
these steps; its navigation actions do not themselves classify tables.
After opening an actor or **Other tables**, use **Back to data overview** in the
header, or press **Escape**, to return. This labelled control is also available
on mobile.

Default table SELECTs use the table name without the physical database prefix
on MySQL/MariaDB. PostgreSQL keeps its schema prefix so tables in different
schemas remain distinct. **Reset to SELECT \*** restores the same default query.

Queries and deliberate edits use Database's existing controls, unlock rules and
confirmations. Check the exact selected database and table before changing data.
Cancellation targets the active query; a cancellation receipt does not prove the
query has stopped or that earlier changes were rolled back. Schema refresh updates
inspection metadata and does not itself run a migration.

If loading fails, use the offered Retry or ask a coding agent to investigate the
configuration. Missing resources require ordinary application preparation. Do not
assume that another session uses the same database: hosted project policy can use
shared project data or separate session databases.

“Database not prepared” means Vibe64 has not confirmed provisioning for this
database identity. Return to the session chat, let the assistant finish and choose
**Prepare workspace**, or **Retry** on failed preparation. Then retry **Database**.
Vibe64 supplies the managed database and credentials; the application's declared
Workspace setup owns migrations. Stored connection configuration alone does not
prove that database users exist. If preparation fails, inspect its error before
retrying. Colleague can inspect and retry the selected session's preparation when
asked, and refresh schema afterward; a retry acknowledgement is not completion.

Open **Copilot** to ask about the database or the currently selected table. It uses
the configured **Helper** destination, looks up bounded parts of the refreshed
schema and can run read-only queries. If a lookup or query fails, that question
stops and shows the error; narrow or correct the request before trying again.
A step-limit error also asks you to narrow the question. If cleanup of the
temporary Helper conversation fails, Copilot shows that error instead of reporting
a successful answer. Cleanup retries address that original Helper and never
resend the question. A new question can start only after the previous Helper is
confirmed closed; changing the current model does not remove that obligation.
A proposed write has not run: **Put SQL in editor** only fills the editor, where the normal unlock and
confirmation rules still apply. On narrow screens Copilot overlays the workspace;
use **Collapse database copilot** to return to the underlying view.

Type a question and select **Send**, or press **Ctrl+Enter** (**Cmd+Enter** on
macOS). Ordinary Enter adds a line. Each question keeps the table selected when
you submit it. Collapsing Copilot keeps an in-progress question running; reopen
the panel to see its answer. Copilot history lasts for the mounted database
workspace and clears when another session loads. That reset keeps an unsent
draft, so check its wording and selected table before sending. A failed question
is not resent automatically.

Colleague can explain these views, inspect authorized status, refresh schema
metadata, open a specific view or exact table, and request cancellation of the
identified active query when asked. It acknowledges actual view/table selection;
that is not proof a query succeeded. It does not receive rows or write SQL itself.
Ask it to send database investigation or a requested change to a coding conversation
and report the evidence. Data-changing work retains its existing confirmation
requirements; a how-to question alone authorizes no query or mutation.
