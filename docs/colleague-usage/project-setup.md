# Start or adopt a project

Use the project's Preview pane to prepare a new or existing application. A setup
screen there means preparation is needed; it is not an application preview.
You need access to the project and an available coding assistant for delegated work.

## Existing project

1. Open the project and its coding session. On mobile, use **Show project** to
   reveal Preview from chat.
2. At **Set up this existing project**, fill **What is this project?** with its
   purpose and what you want to run, then choose **Set up project**. Alternatively,
   choose **Inspect it for me** to have the coding agent investigate first.
3. Follow the coding conversation. Setup is finished only after the agent has
   supplied the required project declarations and normal preparation succeeds.
4. When output controls replace setup, select the intended output and use its
   normal Run control. A successful setup request alone does not mean it is running.

The existing source and Git history are retained. If preparation fails, read the
reported step and use the offered retry after addressing its cause. Do not apply
a starter over an existing repository to repair it.

### Preview accounts for an imported application

If the application has login-protected pages, the coding agent should initiate
preview-access setup during import. It asks which **existing development
accounts** represent an administrator and other roles you need to inspect, and
which should be the default. Supply an email, login or user ID, not a password.
The agent should reuse answers you already gave and wait for your choices.
Choosing a name such as “admin” does not grant that account administrator rights.

The coding agent can implement the application's Preview identity adapter after
you accept that work. To configure named accounts, open **Dashboard > App access**
and use **Managed app access > Add identity**. Enter **Name**, **App identifier**
and **Application value**, choose **Make default** if needed, then **Save**.
On mobile, use **Show project** to reach Dashboard. Colleague can explain these
fields and, when asked, save the supported identity settings; application code
work belongs to the coding agent.

Once the adapter is ready, choose the configured name from Preview's application
identity menu and verify the expected access. Saving the list alone does not
prove the account exists or authentication works. A missing or disabled account
needs a corrected existing account selection; import does not create users,
change roles or reset passwords. If you postpone this setup, the agent should
leave authenticated preview access explicitly pending and continue other setup
work. Public applications and non-web projects do not need preview accounts.

## New project

1. Open the project and create or select its coding session. At **What would you
   like to build with?**, review the available starter cards. The installed JSKIT
   starters include **JSKIT · Public app** (no accounts or database) and
   **JSKIT · Accounts and database** (sign-up, login and MySQL persistence).
   Available starters depend on the installation; do not assume an absent card exists.
2. Choose **Use this starter →** on the intended card only when it matches the
   product you want. Preparation adds it to this session; use the session's
   **Save** control to keep the work in the project. A failed application reports
   its error and preserves existing work.
3. Alternatively, choose **Start through conversation** to open Temporary AI for
   project creation. Discuss what you want, who uses it and its first useful
   outcome before choosing technology. If no starters are configured, this
   conversation route is still offered when a coding assistant is available.

A coding session can exist before application preparation finishes. On mobile,
use **Show project** to see setup and **Show chat** to follow the conversation.

## Colleague assistance

Ask “What does this setup screen need?” for an explanation. Colleague can read
onboarding state without preparing a large coding request, discuss the product,
create an authorized first session, and send an explicitly requested inspection
or setup to that session's coding agent. After you request the task or accept its
offer, Colleague retrieves that exact setup request before sending it.
It can follow the conversation and report the observed result. It does not inspect
the repository itself. An explanation or offer starts no coding work; a direct
request or accepted offer authorizes the specified task. Missing project access,
assistant access or resources must be resolved through their existing setup flow.
