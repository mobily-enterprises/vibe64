# Connect AI accounts and choose Model routing

## Try an app while verification continues

Once an implemented feature's resources are prepared and Preview responds, the
agent should say **Ready to try—give it a spin. Verification is still running.**
You can use Preview immediately; this message is provisional, not proof that all
checks passed. You do not have to test it before the agent continues.

For an implementation in **Auto**, the implementer runs focused code checks and
basic smoke checks of startup, routes and API responses. It may briefly check
that the changed page renders and its main control is present. Full browser
end-to-end tests, multi-step user journeys and visual inspection belong to
**Senior**. Senior exercises the
requested user flow and reports results or remaining gaps. In **Custom** or a
direct role without an automatic review, the same agent remains responsible for
browser verification. A stopped or unavailable check must be reported as
unverified; an invitation to try the app does not replace verification.

Auto shows Working, Waiting or Complete with a separate Planning, Implementation
or Review stage. Senior continues unfinished review or saves necessary in-scope
rework for Junior, then reviews again. Deslop controls cleanup, not whether review
runs. Waiting retains the stage: use its stage-specific **Continue** action when the blocker is
resolved, or **Retry** for an uncertain message. Stop remains respected.
See [plans and workflow recovery](plans.md) for the full steps.

Open **AI Accounts** in Management, or in the local editor through **Account
settings → AI Accounts**. No project or coding session is required.
The local standalone editor does not require a hosted workspace login to open AI
Accounts. To be guided to a good first AI, use [AI onboarding](ai-onboarding.md):
**Redo onboarding** in the local account menu (next to **Account settings**) or
at the top of AI Accounts, or **Set up your AI** in the **Give Vibe64 a
brilliant mind** card shown while no AI is connected (accounts marked
**Reconnect required** do not count). Vibe64 includes no AI of its own; the free
option is GLM-4.7 Flash through a free Z.AI account (see below). OpenCode Zen is
an ordinary keyed provider: add your own Zen key to use it. Its free Big Pickle
model is not offered, and model routing or Colleague choices that named it were
cleared by the release upgrade, so the next use recommends one of your connected
AIs.
Hosted connection changes require the workspace owner. A member's permitted models
can differ from the owner's subscription models; account connection alone does not
grant every collaborator use of it.

## Install Claude Code, Codex or opencode first

Vibe64 talks to each AI through that AI's own program: **Claude Code** for Claude,
**Codex** for ChatGPT and OpenAI keys, and **opencode** for providers connected through
OpenCode. On your own computer these programs must be installed; Vibe64 uses the copy
you installed and the sign-in you already have (Claude Code and Codex keep their
logins in your home folder, so a login made in a terminal works in Vibe64 too).
opencode is different: Vibe64 runs your installed opencode program but signs it in with
the keys you add in AI Accounts, not with opencode's own login.

When a program is missing, AI Accounts (and the matching step of AI onboarding) shows
a warning instead of the sign-in button:

- **Claude Code isn't installed on this computer** (or Codex, or opencode). The warning
  shows the official one-line install command with a **Copy** button and a link to
  **Other ways to install** it. Open a terminal on this computer, paste the command,
  press Enter, then choose **Check again**. You run the command yourself; Colleague
  can explain it but cannot run it for you.
  - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
  - Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
  - opencode: `curl -fsSL https://opencode.ai/install | bash`
- **Codex didn't start** means the program is installed but could not be run at all.
  Choose **Check again**; if it keeps failing, reinstall it with the same command. The
  program's own error output is under **Details**, collapsed.
- A program that runs but isn't signed in, answers too slowly or reports a problem
  with its login files shows the usual sign-in button and its message, so you can
  sign in again.

Vibe64 looks for these programs on your `PATH` and in the official installers' folders
(`~/.local/bin`, `~/.claude/local`, `~/.opencode/bin`, `/opt/homebrew/bin` and
`/usr/local/bin`), so it finds them even when it was started outside a terminal. A
program installed somewhere else must be on the `PATH` of the terminal that starts
Vibe64. When Vibe64 starts, it prints one line for each program it can't find, and
**Dashboard → Health** shows a check for each. Where the host provides pinned versions
of these programs, none of these warnings or install commands appear.

## Connect and check accounts

Use the provider's displayed setup flow. API-key connections offer key entry and
validation; subscription login can require an external browser, one-time code or
authorization code. You perform provider consent and secret entry. Wait for the
saved connected state, and use **Refresh** or **Check saved key** when offered.
Do not reconnect or resend a key solely because a status request was interrupted.
DeepSeek, regular GLM API and GLM Coding Plan connections belong to the
orchestrator shown in that row. Use **Add connection**, choose **Codex**,
**Claude Code** or **OpenCode**, then its provider. Enter a key and complete
that row's verification. Each orchestrator can save a different key, or you can
enter the same key independently for several orchestrators. Connecting or
checking one row does not connect, check or copy a key to another. Regular GLM
API and GLM Coding Plan also remain separate connections within each orchestrator.

When upgrading an older installation to these independent connections, the
operator first checks the candidate's pending upgrades and applies the numbered
credential reset with all writers stopped. The reset follows the existing
assistant-workflow upgrade and preserves its recorded history; it clears saved provider keys locally without revoking them at
the provider. Reconnect the exact orchestrator/provider rows afterward. Colleague
can explain this prerequisite; it cannot run the host upgrade or copy your keys.

Use **Manage** on the exact row to check its saved key, replace it, or remove
that connection. Replacement is checked before the working key is changed.
Replacement and removal affect only that orchestrator/provider. If Codex reports
another native subscriber, close the native terminal using that provider and retry.
Claude Code also requires closing a terminal using the selected provider. If a
terminal's provider cannot be confirmed, close that Claude terminal and retry;
known terminals using another provider keep running. Refusal preserves the saved
key and connection status.
OpenCode may require you to close its native terminals, other-provider chats and
Colleague conversations before changing a key. If it refuses, the saved key stays
unchanged and those conversations keep running; close the named users and retry. Saved routing can still name a disconnected
provider; reconnect the exact row or deliberately choose a different route.
**Start an AI session** lists only orchestrators you can use: one whose account
was removed disappears until you connect it again, while its saved routing is
kept. A connected orchestrator with a routing problem stays visible but greyed
out with its reason; fix it with **Configure model routing**. An existing chat
whose orchestrator is no longer connected shows **Open AI Accounts** and, when
another orchestrator is available, **Switch to** that orchestrator (for example
**Switch to Claude Code**). Switching keeps the chat's Senior, Junior or Auto
mode (Custom becomes Senior), turns automatic review off, and keeps your draft.
The controls and results are the same on desktop and mobile. Colleague can
inspect redacted readiness and explain these steps; secret entry and connection
consent remain your interaction in **AI Accounts**.

For Claude, a failed status check is distinct from being signed out. Retry the
status check before starting another login; Colleague can recheck readiness,
while provider consent remains your step.
If Claude reports that another process is refreshing its OAuth token, wait a
minute before retrying. If the error persists, ask the workspace operator to
check the managed Claude version and refresh-lock recovery. This error alone
does not prove that you signed out or need to replace your credentials.
Changing the workspace's Claude account stops its existing Claude processes.
Main chats keep their history and resume with the newly connected account; they
do not require access to the previous account. Model selection in **Chat mode**
also uses the current workspace connection. If the old process cannot be stopped,
resolve the reported stop failure before retrying; a replacement cannot start
until shutdown is confirmed. Replacing a saved, authorized
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

The workflow picker checks access to your saved Senior, Junior and shared backup
choices. It offers recommendations for roles that have not been configured;
opening the picker does not replace saved choices or deliberately empty roles.
First-time setup loads models for the chosen workflow and any other orchestrator
already assigned to one of its roles. Choosing Codex or Claude Code does not
require OpenCode model discovery unless one of those saved roles uses OpenCode.

Recommendations prefer **Claude → Codex/OpenAI → DeepSeek → GLM** among models
connected and permitted for each role. Within the chosen provider, Senior uses
Opus/Astra, Junior uses Sonnet/Sol, and Helper/Router use Haiku/Luna when offered.
Senior and Junior stay in the selected orchestrator; independent roles can use
other permitted orchestrators. Personal connections cannot supply a shared
backup. **No recommended changes** means the current choices already match the
available recommendations. To review different recommendations for saved
routes, select **Review recommendations**, inspect them, select **Apply to form**,
then **Save routing**. Connecting or reconnecting does not overwrite saved roles.

The model dropdown groups choices under orchestrator headings such as **Codex**,
**Claude Code** and **OpenCode**. Choose an indented model beneath its heading;
the second line identifies its provider and personal or workspace access.
**Recommended** marks the suggested model for that role. Unavailable choices
show their reason and cannot be selected. Type to search by model, orchestrator,
provider or access; only matching groups remain visible. The selected field
shows the model and its orchestrator/access details, without a thinking level.
Use the separate **[role] thinking** control beside it to inspect or change
thinking after selecting a model; the chosen level is included in Save routing.
Recommendation reviews and collaborator outcomes still name the complete model
and thinking selection. On mobile, the controls may be stacked vertically.

Senior and Junior share an orchestrator. Helper and Router have their own allowed
choices. Shared Backup can supply a permitted alternative for collaborators.
Changing routing applies to future work, not a running agent or Colleague's own
model. Select Colleague's model through its own composer model picker; active work
can prevent changing it until its turn stops.

Colleague needs no Model routing step of its own. If an AI shows **Connected**
but its roles were never saved (for example a Codex login that existed before
Vibe64 was installed), Colleague's first message or **Teach me** saves that
workflow's recommended routing, as starting a session does, and uses its
Senior model. Saved choices are never replaced. Colleague says it has **no usable
AI model** only when no connected workflow can supply a Senior model; connect an
AI, or open **Configure routing** and choose an available Senior, then press
Send or **Teach me** again. That message clears by itself once an AI is usable.

If the form says routing changed elsewhere, use **Reload current choices** and
review your retained draft before saving. If no permitted model is usable, finish
the real account/access setup before promising an AI answer. Vibe64 includes no
AI of its own on any installation; **Set up your AI** connects one, including the
free GLM-4.7 Flash option.

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

To connect the regular Z.AI API, use **Add connection** → OpenCode's
**Choose provider**. Wait for the catalogue,
search **Z.AI** in **Search OpenCode providers**, and choose **Z.AI** rather than
**Z.AI Coding Plan**. This opens the same regular API key editor. That route has
no key-creation link: use [Z.AI's key page](https://z.ai/manage-apikey/apikey-list)
in another tab, finish its registration/sign-in steps, then return to the masked
**API key** field and **Verify and connect**. Keep the key out of Colleague chat.
This is Vibe64's free option: GLM-4.7 Flash is free on Z.AI's regular API, so a
free Z.AI account is enough. AI onboarding's GLM card offers the same connection
directly through **Start free**.

For one main conversation, open its chat mode menu and choose **Custom**. Select
**Orchestrator**, then **Model** and **Thinking**, and press **Apply**. The model
list includes the available models from each connected provider for that
orchestrator, including a connected GLM Coding Plan under OpenCode. **Configure
more AIs** opens account setup if the required provider is not connected.
Wait for the selected provider's choices to load before pressing **Apply**.
If those choices changed while the dialog was open, press **Cancel**, reopen
**Custom**, review your selection and apply again. A loading error offers
**Retry**. Neither action changes saved provider connections.
Claude Code uses its selected provider for background model calls as well.

If an administrator's stopped-service upgrade reports an unsupported saved
routing request even though the conversation uses current Senior, Junior, Auto
or Custom, use the corrected candidate release's read-only upgrade preflight.
Valid current choices and pending delivery receipts are preserved by the explicit
upgrade. Do not reset the conversation or change its model to work around that
error. Unknown or corrupt routing still needs administrator inspection before
apply; Colleague can explain the recovery but cannot perform the host upgrade.
