# Connect AI accounts

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

Open **Account settings → AI Accounts** from the account menu. No project or
coding session is required. AI Accounts is the same screen as
[AI onboarding](ai-onboarding.md): while no AI is connected (accounts marked
**Reconnect required** do not count) it shows **Pick the AI behind Vibe64** with
the ranked provider cards; once one is, it shows **Your AI setup** with your
cards first, each with **Manage**, a **Models** summary and the collapsed
**Advanced** panel below them. Which model does which job is explained in
[AI model setups](ai-model-setups.md). Finishing a connection there returns to that overview (**Done**). The
guided flow with its **Why** screen opens from **Redo onboarding** in the account
menu (next to **Account settings**). Vibe64 includes no AI of its own; the free
option is GLM-4.7 Flash through a free Z.AI account (see below). OpenCode Zen is
an ordinary keyed provider: add your own Zen key to use it. Its free Big Pickle
model is not offered, and model or Colleague choices that named it were
cleared by the release upgrade, so the next use recommends one of your connected
AIs.

## Install Claude Code, Codex or opencode first

Vibe64 talks to each AI through that AI's own program: **Claude Code** for Claude,
**Codex** for ChatGPT and OpenAI keys, and **opencode** for providers connected through
OpenCode. On your own computer these programs must be installed; Vibe64 uses the copy
you installed and the sign-in you already have (Claude Code and Codex keep their
logins in your home folder, so a login made in a terminal works in Vibe64 too).
opencode is different: Vibe64 runs your installed opencode program but signs it in with
the keys you add in AI Accounts, not with opencode's own login.

Before you pick a provider, a card in AI onboarding and **Your AI setup** whose program is missing is
greyed and leads with **Install Claude Code first** (or Codex, or opencode), which
opens the install row inside the card; a card whose program runs says **Ready on
this computer** (see [AI onboarding](ai-onboarding.md)). When a program is missing, AI Accounts (and the matching step of AI onboarding) shows
a warning instead of the sign-in button. In **Advanced → Add a connection**, an orchestrator whose
program is missing says **Not installed on this computer** under its name; choosing it
(or **Choose provider** for OpenCode) opens the same warning, and the setup dialog's
status chip reads **Not installed** or **Didn't start** instead of **Not connected**:

- **Claude Code isn't installed on this computer** (or Codex, or opencode). The warning
  shows the official one-line install command with a **Copy** button and a link to
  **Other ways to install** it. Open a terminal on this computer, paste the command,
  press Enter, then choose **Check again**. You run the command yourself; Colleague
  can explain it but cannot run it for you.
  The same commands work on macOS, Linux and Windows inside WSL (Vibe64 runs on
  Windows only inside WSL, so install them in the Ubuntu terminal, not PowerShell):
  - Claude Code: `curl -fsSL https://claude.ai/install.sh | bash`
  - Codex: `curl -fsSL https://chatgpt.com/codex/install.sh | sh`
  - opencode: `curl -fsSL https://opencode.ai/install | bash`

  The setup guides walk through the whole computer: [Linux](set-up-linux.md),
  [macOS](set-up-macos.md), [Windows](set-up-windows.md).
- **Codex didn't start** means the program is installed but could not be run at all.
  Choose **Check again**; if it keeps failing, reinstall it with the same command. The
  program's own error output is under **Details**, collapsed.
- A program that runs but isn't signed in, answers too slowly or reports a problem
  with its login files shows the usual sign-in button and its message, so you can
  sign in again.

Vibe64 looks for a program again every time it starts one, so a program installed
while Vibe64 is running is used as soon as you choose **Check again**; no restart is
needed. It looks on your `PATH` and in the official installers' folders
(`~/.local/bin`, `~/.claude/local`, `~/.opencode/bin`, `/opt/homebrew/bin` and
`/usr/local/bin`), so it finds them even when it was started outside a terminal. A
program installed somewhere else must be on the `PATH` of the terminal that starts
Vibe64. When Vibe64 starts with no AI program at all, it prints one plain message;
**Dashboard → Health** needs one AI program and lists the others as optional. Where the host provides pinned versions
of these programs, none of these warnings or install commands appear.

## Advanced in Your AI setup

Below the provider cards, AI Accounts (and **Your AI setup** in AI onboarding)
has a collapsed **Advanced** panel once any AI is configured. It holds only the connection
plumbing; models are chosen in **Models** (see
[AI model setups](ai-model-setups.md)). Its summary counts the connections, for
example **7 connections · 2 not on a card above**. Select it to open:

- **Add a connection** opens **Choose an orchestrator** (Claude Code, Codex, or
  OpenCode's provider catalog) for an exact orchestrator and provider pair. **Refresh** rechecks every account.
  Codex's own sign-in (ChatGPT login or an OpenAI API key) is listed as
  **OpenAI**, for example **Codex - OpenAI** or **OpenAI through Codex**; its
  models keep their names, such as **GPT-5.5**.
- **Other connections** lists connected providers that have no card, such as
  OpenCode Zen or another OpenCode catalog provider, each **through OpenCode**,
  with **Replace key** and **Remove**. OpenCode Zen's model
  access controls (**Check & enable working models**, **Enable all current
  models**, **Use the recommended model only**, **Cancel check**) are on its tile.
  Changing model access does not stop running answers or terminals; the new
  choice applies from the next message.
  These providers also appear in the **Connected** or **Currently using** strip
  at the top.
- **By tool · Claude Code**, **· Codex** and **· OpenCode** list every connection
  of that orchestrator, with the same buttons. Each row is named as its card
  names it: under Claude Code, your Claude plan is **Claude**, beside keys such
  as **DeepSeek**.

If the connections cannot be read, Advanced shows **AI accounts could not load**
with **Try again**. On a phone the buttons fill the width. The provider cards'
own **Manage** covers the same actions for one provider. The free Z.AI connection's **Free-only
model access** switch (**Unlock all Z.AI models**, with a confirmation because
other Z.AI models use API credit) is in the GLM card's **Manage**, under **Free
option**.

## Connect and check accounts

Use the provider's displayed setup flow. API-key connections offer key entry and
validation; subscription login can require an external browser, one-time code or
authorization code. You perform provider consent and secret entry. Wait for the
saved connected state, and use **Refresh** or **Check saved key** when offered.
Do not reconnect or resend a key solely because a status request was interrupted.
If one account's status cannot be read, only that account shows the reason as
not connected (a Codex account change that is still finishing stays
**Reconnecting**); the other accounts show their usual status. Use **Refresh**
to read it again.
DeepSeek, regular GLM API and GLM Coding Plan connections belong to the
orchestrator shown in that row. The DeepSeek card connects DeepSeek inside
**Claude Code**; to connect it in another tool as well, use **Advanced → Add a
connection**, choose **Claude Code**, **Codex** or **OpenCode**, then its provider. Enter a key and complete
that row's verification. Each orchestrator can save a different key, or you can
enter the same key independently for several orchestrators. Connecting or
checking one row does not connect, check or copy a key to another. Regular GLM
API and GLM Coding Plan also remain separate connections within each orchestrator.
Both offer GLM 5.3; background helpers use the connection you chose, so a
pay-as-you-go GLM helper uses its own key and does not need the Coding Plan.

When upgrading an older installation to these independent connections, the
operator first checks the candidate's pending upgrades and applies the numbered
credential reset with all writers stopped. The reset follows the existing
assistant-workflow upgrade and preserves its recorded history; it clears saved provider keys locally without revoking them at
the provider. Reconnect the exact orchestrator/provider rows afterward. Colleague
can explain this prerequisite; it cannot run the host upgrade or copy your keys.

Open the provider card's **Manage** (or find the row under **Advanced**) and use
**Replace key** or **Manage sign-in** on the exact orchestrator's tile to check
or replace its key, or **Remove** to remove that connection; removing asks for
confirmation first. Replacement is checked before the working key is changed.
Replacement and removal affect only that orchestrator/provider. If Codex reports
another native subscriber, close the native terminal using that provider and retry.
Claude Code also requires closing a terminal using the selected provider. If a
terminal's provider cannot be confirmed, close that Claude terminal and retry;
known terminals using another provider keep running. The refusal names the
sessions whose terminal is still open; a terminal that has already exited or
been closed no longer blocks the change. Refusal preserves the saved key and
connection status.
Connecting, replacing or removing an OpenCode key returns at once. Running
OpenCode chats and Colleague conversations keep going: a reply already being
written finishes on the key it started with, and the next message uses the saved
key. A new message in a chat whose reply is still being written starts once that
reply ends. After you remove a connection, a message for that provider ends with
a notice to connect it again in **AI Accounts**; it never hangs. Only an open
OpenCode native terminal still refuses the change: close it and retry. The
refusal leaves the saved key unchanged.
Removing a connection keeps the saved model choices that name it; reconnect the
exact row or deliberately choose other models in **Models**. Removing a Codex
connection also deletes that connection's Codex logs and temporary files; its
past chats stay. Main chat always
runs in your Senior's tool, so a removed Senior connection stops main chat until
you reconnect it or choose another Senior.
The controls and results are the same on desktop and mobile. Colleague can
inspect redacted readiness and explain these steps; secret entry and connection
consent remain your interaction in **AI Accounts**.

For Claude, a failed status check is distinct from being signed out. Retry the
status check before starting another login; Colleague can recheck readiness,
while provider consent remains your step. **AI Accounts** shows the same Claude
Code sign-in your chats use.
If Claude reports that another process is refreshing its OAuth token, wait a
minute before retrying. If the error persists, ask the workspace operator to
check the managed Claude version and refresh-lock recovery. This error alone
does not prove that you signed out or need to replace your credentials.
Changing the workspace's Claude account (signing in, signing out or
**Remove AI**) stops no chat, Colleague answer or goal and waits for none of
them: the account's new state shows as soon as Claude Code's own sign-in or
sign-out finishes. Claude Code reads the
current sign-in for each request, so work in progress continues on the newly
connected account. After a sign-out, a running chat's next request ends at once
with "Claude isn't connected. Sign in to Claude, then send your message again."
Nothing hangs; sign in again and resend.
Switching, signing in to or disconnecting Codex finishes at once and never stops
an answer in progress. An answer Codex is already writing finishes on the account
it started with; messages you send after it finishes, and new conversations, use
the new account. A Codex goal that was running pauses on the previous account and
continues on the new one by itself once that answer finishes. If Codex is no
longer connected, the goal stays paused and a new message says **Codex (OpenAI)
isn't connected**; sign in to Codex here, then send your message again or choose
**Goal** → **Resume goal**.
Sign-ins and key checks show a spinner and what is happening while they wait,
as described in [AI onboarding](ai-onboarding.md#while-it-works).
Main and temporary chats keep their history and resume with the newly connected account; they
do not require access to the previous account. Model selection in **Chat mode**
also uses the current workspace connection. Replacing a saved, authorized
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

To check your saved API connections, ask Colleague, for example “Which AI
connections are saved and ready?” or “Is my regular Z.AI connection saved?”
The workspace owner can get a fresh, read-only check without opening a project.
It covers every provider saved in **AI Accounts** (Z.AI, a Z.AI Coding Plan,
OpenAI, OpenCode Zen and any other), and for each one reports whether it is
ready, why not when it is not, whether it is the preferred provider, its default
model and whether its model policy is recommended-only or unlocked. It never
reads out the key, key hint or fingerprint. Claude and Codex sign-ins are not
saved connections. A Personal Coding Plan is a separate connection from regular
Z.AI; it does not satisfy a regular Z.AI check. If connection storage is
unavailable, Colleague reports that instead of saying you are disconnected. On desktop and phone,
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
The preferred provider/default-model badge does not prove which models Vibe64
uses or change Colleague's model. Ask for the actual choices in **Models** before
changing only the requested role. A correct lesson answer establishes understanding,
not successful account setup or model execution.

To connect the regular Z.AI API, use the GLM card's free option (**Start free**
or **Already have a key? Connect**), or **Advanced → Add a connection** → OpenCode's
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
Wait for the choices to load before pressing **Apply**. If they changed while
the dialog was open, **Apply** shows why it was refused and reloads them; review
your selection and press **Apply** again. A loading error offers **Retry**.
Neither action changes saved provider connections.
Claude Code uses its selected provider for background model calls as well.
To start a new session on such a choice, select **Change** in **Start an AI
session**: it opens the same **Custom AI** choice, and the new chat starts in
Custom (see [Create and switch sessions](sessions.md)).

If an administrator's stopped-service upgrade reports an unsupported saved
model request even though the conversation uses current Senior, Junior, Auto
or Custom, use the corrected candidate release's read-only upgrade preflight.
Valid current choices and pending delivery receipts are preserved by the explicit
upgrade. Do not reset the conversation or change its model to work around that
error. Unknown or corrupt routing still needs administrator inspection before
apply; Colleague can explain the recovery but cannot perform the host upgrade.

Colleague can explain these steps, inspect account readiness and point at AI
Accounts; it cannot open it for you. It offers help without changing anything for a how-to question.
Connection, consent and model-access steps it cannot perform must be completed
in the actual account screens; it rechecks status after you finish. Vibe64
includes no AI of its own on any installation; AI Accounts or AI onboarding
connects one, including the free GLM-4.7 Flash option.
