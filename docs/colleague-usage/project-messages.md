# Message another coding session

Open the destination project and select the session that should receive requests.
Its Main chat must have an available assistant. This is the same project/session
selection on desktop and mobile; a temporary chat is never the recipient.

Ask your coding assistant to send the request. For example: “Tell jskit-ai to
review the changes, publish if already authorized, and ping this project with
the package versions.” The coding assistant uses:

```sh
vibe64-helper session message-project jskit-ai "Review the changes, then ping vibe64-online with the result and published versions."
```

Without `--session`, the destination's **currently selected session** receives the
message in Main. To address a particular session, including another session in
this same project, copy its ID from **Session info** and use:

```sh
vibe64-helper session message-project compas-next --session 2026-10-11_14-18-36 "Please review the shared controller change."
```

The exact session receives the message even if a different session is selected or
pinned. It must be active and have an available assistant; the project must remain
open. This command does not switch tabs or change the project's selection.
Sending to your own session fails with a clear error before delivery or a sent
receipt is created. Choose the other session explicitly; if no other recipient
exists, report the limitation to the person instead of repeating the command.
New messages appear as bubbles with a robot avatar outside, the source project's name
and a link to its session, on a neutral background distinct from human messages.
They share the human message width limit on desktop and mobile. Markdown paragraphs,
lists, links and code are rendered; long messages have **Read more** and **Show less**.
Received messages appear on
the left; sent messages appear on the right, with their timestamp and delivery
status inside the bubble. They are not human messages.
Bubbles show the actual message, without the internal permission and reply-command
instructions supplied to the receiving assistant.
Ordinary replies and progress updates to you use indented, shaded chat bubbles
beneath the assistant's name. Messages between projects instead use neutral,
outlined bubbles with explicit **To**/**From** project links, so the recipient
remains clear.
The sender's Main chat retains the message body, destination session and delivery
status, including when the command came from a temporary conversation. Sending is
**fire-and-forget**: after checking access, the open project and its addressed
assistant, the command returns an acceptance receipt identifying that session
and message. It does not wait for native delivery, an acknowledgement or task
completion. Ask the recipient to ping back later if you need a result.
**Accepted · delivery not confirmed** is not proof of delivery. **Delivered to
assistant** confirms native acceptance, not task completion. **Delivery failed**
includes the reported failure; it also remains in the workspace log. Do not resend solely
because no immediate reply appeared. Pending dispatch is not a durable inbox and
is not promised to survive a daemon shutdown.
The recipient uses the same command to send requested answers, results or blockers
back to the exact source project and session, using `--session` from its reply instructions. An ordinary chat answer is shown to the person; it is
not sent to the other assistant. Completed reports need no acknowledgement unless
one was requested. Replies retain the original sender as their destination even when project selection changes.

A closed or closing project, missing selected session, unavailable assistant or
denied project access returns an error. An explicit missing or inactive session fails
without falling back to the selected session. Nothing is held for a future session, and
the command never opens a project or selects a fallback. Resolve the reported
condition before trying again. After a transport timeout, inspect the returned
message reference/history before resending; do not assume delivery failed.

An optional final message ID can correlate retries in the same destination
session. Without `--session`, a changed selection means a different recipient;
check it before retrying. Use a known session ID for a specific colleague.
If the recipient is unclear, ask instead of guessing.
Keep tracking IDs in that argument rather than at the start of visible messages.
Write naturally in Markdown: lead with the result or request, use short paragraphs
and useful bullets, and format commands and paths as code. Include essential
evidence without dumping logs.

Messages from assistants retain existing permissions. They are not fresh human
authorization to publish, deploy or perform restricted operations. Learning
sessions cannot send project messages.
Agents may coordinate development and releases within work the person has already
authorized. Messages cannot override restrictions such as “test only, no edits.”
If new permission is needed, the recipient asks the person once and reports the
blocker to the sender once. They stop that exchange until a decision arrives and
continue independent authorized work. Send useful results, consequential questions
or blockers; avoid acknowledgement-only replies and polling. The assistant tells
the person what it sent. These are agent instructions, not a guarantee that a model
will never repeat itself.

Older messages retain their original presentation; no sent history is reconstructed.

Colleague can explain how to select the destination and offer its existing
project/session controls. This command is available to coding assistants;
Colleague has no shell access and cannot claim it sent a message itself.

Message commands are included in Main and temporary coding-agent instructions.
Host-specific guidance shares the same bounded instruction budget; adding it must
not prevent either conversation from starting.

Installed host instructions reach coding assistants through the host environment
filter. On a configured VPS they include the local update and SSH restore commands;
hosts without that facility do not advertise it.

If the destination has a pinned source session, that is its server-selected
session for messages without `--session`, even while someone browses another tab. Unpinning restores ordinary
selection. Pinning does not change message permissions or acknowledgement rules.
