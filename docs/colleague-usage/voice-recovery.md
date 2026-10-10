# Recover voice chat and speech review

These steps apply to Main and Colleague. For capture, sound and switching targets,
see [Voice chat](voice-chat.md); for uncertain chat delivery and retained chats,
see [Colleague delivery and recovery](colleague-recovery.md).

## Recover

A connection failure stops stale playback and capture. Brief reconnect attempts
do not resend audio, replay replies or reopen the microphone automatically.
Interrupted words remain for review where recognition reached the browser. Use
Send to retry that same message identity or Discard to abandon it. A saved receipt
clears an uncertain submission without sending it again. Check the target title
before retrying. If the speech service is unavailable, typed chat remains usable.

Reopening a Claude chat reads its saved replies. A finished reply replaces its
matching partial text; an interrupted partial is not a finished answer. If you
lose chat updates, reconnect before deciding to send the same request again.

The four controls beneath the face sit close together. Hands-free pauses still
complete separate messages.
Further speech is not merged into earlier queued messages.


A previously saved **edit before send** choice also applies to Main and Colleague.
With that choice, completed speech waits in its review message instead of sending
at a pause. Review or edit the words, then use **Send**; discard them with the
existing cancel control. The message keeps the conversation captured when you
started speaking, including after navigation or a failed-send retry. The normal
default still sends completed speech automatically, and input and playback stay
independent. There is no new settings control for this retained choice.

Online waits for your saved settings before opening a new voice target. An existing
voice target stays owned while those settings load. If loading fails, retry opening
voice or use typed chat; your words are not automatically submitted. Reopening an
already active target does not add a new microphone readiness gate.

A temporary Online settings refresh error keeps an already loaded saved review
choice for the same account. It does not silently switch that active microphone
to automatic sending. A new voice target still waits for its settings to load.
