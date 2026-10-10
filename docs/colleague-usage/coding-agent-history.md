# Attach files and read coding-agent history

For sending and steering, see [Coding agents](coding-agents.md). These steps cover
attachments, retained history and required operator upgrades.

## Attachments and saved history

Add files through the composer before selecting **Send** or **Steer**. Images
use the selected agent's image input; other files remain available to its file
tools. Changing a native binding does not grant access to another conversation's
files. Keep the same request when checking uncertain delivery.

Archived native history is preserved before cleanup. Cleanup uses the saved
conversation's agent and storage location; switching the current chat's agent does
not change that target. Busy conversations, a changed native storage directory,
incomplete exports or interrupted preservation prevent
deletion. Let active work finish;
ask the workspace operator to retry native-history cleanup after resolving the
reported error. These rules apply on desktop and mobile. Colleague can explain
the error; host storage repair and cleanup require the operator.

## History needs an upgrade

If opening a chat reports that it needs the offline state upgrade, ask the
workspace operator to complete the application update before using **Send**.
Closing the tab or repeating a message cannot perform this upgrade. The operator
must stop the services and run the candidate release's state-upgrade command;
Colleague can explain the error but cannot perform that host operation. The same
recovery applies on desktop and mobile. Existing replies, attachments, attribution
and undone-turn receipts are retained; the upgrade does not resend messages.

## Read older messages while replies arrive

Scroll up and use **Load older messages** when it is shown. Incoming replies
retain the history you loaded and your place in it, including on phone. Your
unsent draft and selection remain intact. Updated or removed saved messages
reflect the current conversation; live output does not replace its original
question or progress.

A reconnection starts with the latest page again. Use **Load older messages**
to return farther back. A failed history refresh retains the visible messages;
use the existing **Reload chat** recovery if shown. Access denial clears cached
private messages instead: sign in with the authorized account and reopen chat.
Colleague can explain these steps; scrolling and loading this browser's history
require your interaction. These operations do not resend any request.
