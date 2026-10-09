# Connect AI accounts and choose Model routing

Open **AI Accounts** in Management. No project or coding session is required.
The local standalone editor does not require a hosted workspace login to open AI
Accounts. Hosted connection changes require the workspace owner. A member's permitted models
can differ from the owner's subscription models; account connection alone does not
grant every collaborator use of it.

Use the provider's displayed setup flow. API-key connections offer key entry and
validation; subscription login can require an external browser, one-time code or
authorization code. You perform provider consent and secret entry. Wait for the
saved connected state, and use **Refresh** or **Check saved key** when offered.
Do not reconnect or resend a key solely because a status request was interrupted.
For Claude, a failed status check is distinct from being signed out. Retry the
status check before starting another login; Colleague can recheck readiness,
while provider consent remains your step.
If Claude reports that another process is refreshing its OAuth token, wait a
minute before retrying. If the error persists, ask the workspace operator to
check the managed Claude version and refresh-lock recovery. This error alone
does not prove that you signed out or need to replace your credentials.
If an existing Claude conversation reports that its account changed, reconnect
the original Claude account or start a new session. Replacing a saved, authorized
external-provider API key does not require a new Claude conversation. Its next
message uses the updated connection; you do not need to close and reopen the chat.
If a background Codex task reports that its selected account changed, its answer
is not accepted. Check the intended connection in **AI Accounts**, then retry the
original task once that connection is ready. A normal credential refresh for the
same account does not invalidate the answer. Colleague can inspect readiness;
provider login and secret entry still require you. This applies on desktop and
mobile.

Claude's plan allowance shows only valid provider-reported usage windows. A
missing allowance does not mean unlimited usage. If a model-list or allowance
request reports that process cleanup could not be confirmed, ask the workspace
operator to restore the execution service before retrying the request.
The same applies when Claude cannot open its managed conversation stream after
startup: failure to confirm cleanup does not mean the process has stopped. Keep
the current conversation and ask the operator to restore its execution service;
use its existing **Stop** control to retry owned cleanup when available. Do not
change models or resend the pending words until cleanup and delivery are resolved.
Colleague can explain the error and inspect readiness, but cannot repair the
host's process service. These recovery steps apply on desktop and mobile.

After connecting, the **[provider] connected** screen names the orchestrator you
selected. For example, connecting DeepSeek through Codex shows only Codex's
optional suggestions and **Configure Codex routing**, even if the key also works
with Claude Code. Review **Current** and **Suggested**, select the changes you
want, then use **Apply [number] changes**. **Keep current routing** leaves the
connection ready without applying those suggestions. If no changes are suggested,
use **Done** or the same orchestrator's Configure routing button.

Open the orchestrator's **Configure routing** control to choose its supported
**Senior**, **Junior**, **Helper** and **Router** destinations and thinking choices.
The displayed routing form can also offer **Review recommendations**,
**Confirm Helper** and **Save routing**. Follow any
required review, then Save routing. On mobile, scroll the same dialog to its controls.
Disabled models are unavailable or incompatible; they must not be invented.

Senior and Junior share an orchestrator. Helper and Router have their own allowed
choices. Shared Backup can supply a permitted alternative for collaborators.
Changing routing applies to future work, not a running agent or Colleague's own
model. Select Colleague's model through its own composer model picker; active work
can prevent changing it until its turn stops.

If the form says routing changed elsewhere, use **Reload current choices** and
review your retained draft before saving. If no permitted model is usable, finish
the real account/access setup before promising an AI answer. An included model
can be available on hosted installations; verify the actual catalogue.

Colleague can explain these steps, inspect account/routing readiness, open AI
Accounts and save supported routing changes when the owner explicitly asks. It
offers assistance without changing anything for a how-to question. Connection,
consent and model-access operations that are not exposed to it must be completed
in the actual account UI; it should recheck status after the person finishes.

For regular Z.AI setup, ask Colleague “Is my regular Z.AI connection saved?”
The workspace owner can get a fresh, read-only check without opening a project.
It reports the saved connection, preferred provider, default model and whether
the account's model policy is recommended-only or unlocked. It never reads out
the key, key hint or fingerprint. A Personal Coding Plan is a separate connection;
it does not satisfy this check. If connection storage is unavailable, Colleague
reports that instead of saying you are disconnected. On desktop and phone,
registration, masked **API key** entry and paid-model consent remain your steps
in **AI Accounts**. If a check fails, reopen AI Accounts and inspect its saved state;
do not paste a key into chat or reconnect solely because of a failed read.

Saved state is not a live key, credit or paid-model entitlement check. In particular,
full **GLM-4.7** uses paid regular-API credit and differs from free **GLM-4.7-Flash**.
If **Verify and connect** reports that Z.AI is temporarily overloaded, nothing
was saved: wait and retry the same key. This does not establish invalid credentials.
If it reports insufficient balance or no resource package, check the provider's
billing and quota before retrying. A failed replacement keeps the existing saved
key. These messages and steps apply on desktop and mobile. Colleague can explain
the reason; key entry remains your step in **AI Accounts**.
The preferred provider/default-model badge does not prove future Senior routing
or change Colleague's model. Ask for the actual routing before changing only the
requested future workflow role. A correct lesson answer establishes understanding,
not successful account setup or model execution.

If an existing GLM Coding Plan hides **Connect regular Z.AI API**, use
**Add connection** → OpenCode's **Choose provider**. Wait for the catalogue,
search **Z.AI** in **Search OpenCode providers**, and choose **Z.AI** rather than
**Z.AI Coding Plan**. This opens the same regular API key editor. That route has
no key-creation link: use [Z.AI's key page](https://z.ai/manage-apikey/apikey-list)
in another tab, finish its registration/sign-in steps, then return to the masked
**API key** field and **Verify and connect**. Keep the key out of Colleague chat.

For one main conversation, open its chat mode menu and choose **Custom**. Select
**Orchestrator**, then **Model** and **Thinking**, and press **Apply**. The model
list includes the available models from each connected provider for that
orchestrator, including a connected GLM Coding Plan under OpenCode. **Configure
more AIs** opens account setup if the required provider is not connected.
Claude Code uses its selected provider for background model calls as well.

If an administrator's stopped-service upgrade reports an unsupported saved
routing request even though the conversation uses current Senior, Junior, Auto
or Custom, use the corrected candidate release's read-only upgrade preflight.
Valid current choices and pending delivery receipts are preserved by the explicit
upgrade. Do not reset the conversation or change its model to work around that
error. Unknown or corrupt routing still needs administrator inspection before
apply; Colleague can explain the recovery but cannot perform the host upgrade.
