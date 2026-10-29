# Start a temporary chat with recent context

Open **Temporary AI** to create the first chat, or select **New temporary AI task**
(the plus beside existing temporary chat tabs). When the session already has
temporary chats, **Temporary AI** opens them instead and offers no new chat. Leave
**Include recent chat context** unchecked for an empty conversation, or check it
and select **Create chat** to copy recent context from Main in this session.
When Main has no messages yet there is nothing to copy, so the chat opens
directly without this choice; the dialog appears only if creation fails, with
its error and **Create chat** to retry. Creating the chat sends no AI request. Enter your question and send it normally.
The controls work the same way on desktop and compact screens.

The copy contains up to forty visible user, assistant and progress messages at
the time the server creates the chat. It includes text only, not attachment
contents, hidden reasoning or internal role instructions. A 64 KiB text limit
keeps the newest messages first. Until the first message is sent, the temporary
chat notes how many messages were copied and whether any text was omitted.
Drafts save automatically; a note appears only if a draft could not be saved. Main continues independently. Later messages and edits in either
conversation do not update the other. Both still work in the same session source,
so edits made by either coding agent affect that shared working tree.

A failed creation keeps its error and the same chat identity for retry. Retrying
a creation that already succeeded retains its original copy. Changing the model
uses the ordinary conversation history handover; it does not capture Main again.
Existing temporary chats are unchanged, and opening or reloading them does not
import context. Close a temporary chat through its tab's existing **Close** control.

Colleague can explain the option and create a temporary chat with copied context
when explicitly asked, using the existing create-conversation action. It must not
enable context copying merely because the person asked how the option works.
