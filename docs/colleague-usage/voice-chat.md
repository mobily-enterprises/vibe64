# Voice chat with Colleague or a project agent

A configured speech service and a browser with microphone permission are required.
Open Colleague from the header: its **Talk** view opens first. Use **Text** at
the top for written chat, and **Talk** to return. For a project's Main coding
conversation, choose the **Talk to project agent** headset icon immediately left
of the blue **Send** button in the message box. Both open the same
voice window; its
title identifies the destination. Opening it does not start recording.

## Start and speak

Use the single **Talk** button. Tap it to listen hands-free and send after a
pause. Tap **Pause** to finish the current utterance and pause the microphone;
the completed words are sent automatically. Tapping **Talk**
again starts a fresh recording. Hold **Talk** for push-to-talk,
then release to send. Space or Enter has the same tap/hold behavior while the
button has focus. Connection setup happens automatically. Allow microphone
access when prompted and wait for **Listening to you** before speaking.
Releasing before the microphone is ready cancels that recording.

Both caption boxes scroll independently: use the wheel over either box, swipe
inside it, or focus it and use the arrow keys. Scrolling up pauses automatic
following while more text arrives; return to the bottom to follow again. The
portrait and call controls stay fixed.

The **You** caption shows recognized words; the answer caption shows the current
reply, including when sound is off. Your typed draft stays separate. If a recording
requires review after interruption or failure, edit **Review your message**, then
choose **Send** or **Discard**.
Holding the Colleague launcher opens a separate recording for review, requiring
explicit **Send**. You can listen while the assistant replies.

Speech uses the conversation's existing model, permissions and tools. It starts
an ordinary request or steers permitted active work. Voice does not choose another
reasoning model. Colleague can explain these controls and carry out requests through
its existing actions; browser permission and recording gestures require you.

## Sound, voices and stopping

The microphone icon on **Talk / Pause** shows whether input is active. The speaker
icon shows whether spoken replies are enabled; select it to change that setting.
**Stop … speaking** stops current and queued audio immediately. It remains quiet
until a fresh request or explicit read-aloud enable. **Stop agent work**, when present,
separately cancels the agent's work. The top-right **Close voice chat** X stops sound,
releases the microphone and closes the session without stopping agent work.
Closing discards unsent speech; your typed draft and saved messages remain.

Open the **Voice settings** cog in the window header, then choose **Speaking
voice**. Opening settings loads the installed choices without recording. The
change applies to the next spoken reply. In standalone Vibe64 it lasts for the
current voice session; a host with saved speech preferences can replace this
selector and retain the choice across sessions. Vibe64 Online saves it workspace-wide
through the same control as Management → Speech and Colleague.
Choices and defaults come from the installed model pack and may include male and
female voices. If only one voice is installed it is shown but cannot be changed.
Server model setup is an operator task.

Answers start speaking in short phrases before completion; code and dense tables
remain in chat. Existing history is not replayed when the window opens. Spoken
“Stop talking”, “Stop speaking” or “Be quiet” stops audio locally in either live
mode. Other wording is an ordinary message, so use the explicit button if recognition
is wrong. Pause detection and echo cancellation depend on the recording environment.
Use push-to-talk or review when pauses/noise make hands-free unreliable.

## Navigate and switch targets

The top-right **Minimize conversation** minus hides the window while voice
continues. On desktop, clicking the header avatar while the window is open also
minimizes it. A badge on the header avatar shows the minimized session. Its microphone
symbol and ring indicate active listening; a headset indicates a retained session
that is not listening. Tap the avatar to reopen the same destination, or the
adjacent **Stop voice chat** X to stop audio without reopening it.
Navigate to another screen without redirecting the current recording.
In Colleague, selecting **Text** keeps voice active while showing written chat.
The minus and X occupy the same positions in Talk and Text. X, Escape, or an
outside click away from the header avatar closes the view and stops voice; use
minus or the avatar to keep listening.
Open voice for a different conversation to switch. Unfinished words require
completion or **Discard and switch**; **Stay here** keeps the original target.
There is only one voice window and one active capture/playback owner.

Signing out, losing access to the target, or leaving the page releases its
resources. A project agent remains the selected voice target even if its text
view is no longer mounted. Temporary and host-owned repair chats do not have a
project voice launcher.

Desktop and mobile use the same controls. Talk and Text have the same window
size and the same icon-labelled tabs, with no switching animation. Both views
fill the screen on mobile. Text uses the full area below the tabs
for messages and the composer, with no portrait. In Talk the larger portrait and
controls stay fixed; the compact captions below it scroll independently. On short screens the portrait
becomes smaller. Minimize before using another page's controls; the dialog owns
focus while open.

## Recover

A connection failure stops stale playback and capture. Brief reconnect attempts
do not resend audio, replay replies or reopen the microphone automatically.
Interrupted words remain for review where recognition reached the browser. Use
Send to retry that same message identity or Discard to abandon it. A saved receipt
clears an uncertain submission without sending it again. Check the target title
before retrying. If the speech service is unavailable, typed chat remains usable.
