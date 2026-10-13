# Ask another project's assistant

Open the destination project and select the session that should receive requests.
Its Main chat must have an available assistant. This is the same project/session
selection on desktop and mobile; a temporary chat is never the recipient.

Ask your coding assistant to send the request. For example: “Tell jskit-ai to
review the changes, publish if already authorized, and ping this project with
the package versions.” The coding assistant uses:

```sh
vibe64-helper session message-project jskit-ai "Review the changes, then ping vibe64-online with the result and published versions."
```

The destination's **currently selected session** receives the message in Main.
The visible text starts with its source project and session. A delivery receipt
identifies the destination session and message; it does not mean the task finished.
The recipient can use the same command to reply to the source project. Replies
use whichever session is selected there when sent.

A closed or closing project, missing selected session, unavailable assistant or
denied project access returns an error. Nothing is held for a future session, and
the command never opens a project or selects a fallback. Resolve the reported
condition before trying again. After a transport timeout, inspect the returned
message reference/history before resending; do not assume delivery failed.

An optional final message ID can correlate retries in the same destination
session. A different selection is a different recipient, so check it before retrying.

Messages from assistants retain existing permissions. They are not fresh human
authorization to publish, deploy or perform restricted operations. Learning
sessions cannot send project messages.

Colleague can explain how to select the destination and offer its existing
project/session controls. This command is available to coding assistants;
Colleague has no shell access and cannot claim it sent a message itself.
