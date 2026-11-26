# Report a problem

When something in Vibe64 goes wrong, **Report a problem** gathers what the editor
saw around it into one report. You read the whole report before it goes
anywhere. On your own computer it goes nowhere by itself: you **Download** it or
**Copy** it, and paste or attach it where you report the problem (for example a
GitHub issue).

## Opening it

- From any page: the **Account** menu (top right) → **Report a problem**.
- From a chat, where a problem shows: **Report a problem** on a routed request
  that failed (the notice above the message box, for example "Scheduling
  disconnected before the handoff was sent."), and on a red turn interruption
  entry in the chat's history. These start with the chat's messages ticked in.

Opened on a session's page, the report describes that session and offers its
main chat; opened anywhere else in a project, it describes the project's page;
outside a project, only the page and the editor.

## The form

- **What went wrong (optional)**: your own words, up to 4,000 characters.
  Secret-shaped text in it (keys, tokens, passwords) is hidden like the rest.
- **Include the messages of the chat I was in**: shown only on a session's page.
  Ticked, the report carries the main chat's newest 50 messages, masked.
  Unticked, it carries none of the chat's words. Changing it gathers the report
  again.

## What the report includes

Under **What this report includes**, one line each:

- **Page**: the page's name and address, and **You**: your username and role.
- **Time**: the six hours before you opened it.
- **Session**: its turns (who asked, which AI and role, when, and whether it
  answered; never their words), its timeline's events, its plan (title, status,
  which item it is on), and the state the AI request saved (its stage, status,
  delivery, error and each role's AI). Never who submitted it by email, and
  never the copies of messages a follow-up keeps.
- **Preview**: its state and message, when the session has one.
- **Errors this page saw**: the errors and warnings this browser tab showed since
  it opened (up to 50).
- **Editor crashes**: when Vibe64's own server crashed in those hours, of what
  kind, and the error's name and code. A crash's message stays on the
  [Crashes](crashes.md) page.
- **Versions**: the app, JSKIT, Genesis and Node, and the session's AI engine and
  model.
- **Chat messages**: how many, or **not included**.

The chip beside it counts the values hidden. Env values, keys, passwords,
tokens, cookies and credentials in addresses are replaced with `[hidden]`
everywhere in the report: the project's saved Env values that are secret, whose
names say they are (such as `..._TOKEN`, `..._PASSWORD`, `DATABASE_URL`), or
that are long, and every key or token shape Vibe64 knows (GitHub, OpenAI,
Anthropic, Stripe, AWS, Google, npm, Slack, JSON Web Tokens, private keys,
`Authorization:` and `Cookie:` lines, `NAME=value` secrets). No source code is
included.

**Show the whole report** shows the exact JSON that **Download** saves and
**Copy** copies.

## Download and Copy

- **Download** saves the report as `vibe64-problem-report-<date>T<time>.json`.
- **Copy** copies the same JSON. The button says **Copied** once it worked. If
  the browser refuses, use Download, or open **Show the whole report** and
  select its text.

Read it once more before you share it: masking hides what Vibe64 recognises, and
your own words or a chat can still hold something private.

## When a host delivers reports

An editor run by a hosting service may also show its own **Send** button, with
its own choices (such as letting its team look at your project). Without one,
nothing is sent, and the server refuses a send with "This editor sends problem
reports nowhere: download or copy the report instead."

## If it fails

- "This report's review has expired. Open Report a problem again.": the gathered
  report is kept for 30 minutes, and only for you. Open it again.
- A session that cannot be read (for example one that was just deleted) is named
  in the report as unreadable; the rest of the report still comes.

## What Colleague can do

Colleague can explain this guide and point at **Report a problem** in the
Account menu (its guide place `report-a-problem`); the report itself is
gathered, read and downloaded by you in its dialog.
