# Start an AI task with recent context

Choose **New AI task** in the session header (or in **Session actions** when the
header is narrow). When Main chat has messages, the form offers **Include recent
chat context**. Leave it unchecked for a task that starts empty, or check it to give
the task a copy of recent context from Main in this session. When Main has no
messages yet there is nothing to copy, so the form doesn't offer it. Say what the AI
should do and choose **Start**; the AI task window opens on the task. The controls
work the same way on desktop and compact screens.

The copy contains up to forty visible user, assistant and progress messages at
the time the server creates the task. It includes text only, not attachment
contents, hidden reasoning or internal role instructions. A 64 KiB text limit
keeps the newest messages first. Main continues independently. Later messages and
edits in either conversation do not update the other. Both still work in the same
session source, so edits made by either coding agent affect that shared working tree.

If the task can't start, for example because another task is still open, the form
stays open with what you typed. Changing the model uses the ordinary conversation
history handover; it does not capture Main again.

Colleague can explain the option and start a Colleague task with copied context
when explicitly asked, using the AI task start action with
`includeRecentChatContext`. It must not enable context copying merely because the
person asked how the option works.
