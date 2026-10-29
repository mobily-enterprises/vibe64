# Voice chat with Colleague or a project agent

Open Colleague from the header for one conversation with written messages,
typing and optional speech controls. On desktop its right-hand drawer leaves the
workspace and Preview usable beside it; phones show that same conversation
fullscreen. Minimize hides the frame without ending speech, and reopening or
resizing preserves the current conversation and separate typed draft. There are
no Talk/Text mode tabs. Typed chat remains available when speech is unavailable.
Recording requires a configured
speech service and browser microphone permission. For a project's Main coding
conversation, use the microphone beneath the face at the upper-right of the
message area. Main keeps its original transcript and message box, with the same
avatar and voice controls as Colleague. After hiding the face, choose **Show avatar**
at the top-right to restore it; messages scroll behind it. Showing the face does
not start recording or enable spoken replies. Each assistant starts every later
page load and session the way you last left its face; see
[Keep the face shown or minimised](voice-face-and-speaking-voice.md#keep-the-face-shown-or-minimised). The message box has no separate
headset launcher.

## Start and speak

Use the single **Talk** button. Tap it to listen hands-free and send after a
pause. You can keep speaking and send typed steering while the agent works or
reads its reply aloud. Recognized words appear in a temporary user bubble as
you speak. Tap **Pause** to finish the current utterance and pause the microphone;
new microphone input stops immediately while the remaining audio is interpreted,
then the completed words are sent automatically. If an earlier message is still
awaiting admission, Pause retains the captured audio and finishes the new utterance
once that admission settles, preserving both sets of words. Sending does not disable Talk:
tap again to resume an open recording or start a fresh one after it finishes.
The idle microphone is crossed out; it appears active only while actually
listening and unmuted. Hold **Talk** for push-to-talk,
then release to send. Space or Enter has the same tap/hold behavior while the
button has focus. Connection setup happens automatically. Allow microphone
access when prompted and wait for the microphone icon to show active capture
before speaking.
Releasing before the microphone is ready cancels that recording.

Colleague displays accepted messages and replies in its ordinary scrollable
transcript. The face starts at the top edge of the message area, below the
header, shown unless you last minimised it. After hiding it, the anonymous **Show avatar** icon reveals the
larger face, smaller microphone/speaker buttons and its settings cog. The small
round minus button at the end of that controls row tucks them away (accessible label
**Minimise avatar**). There is no size menu. In Colleague's narrow drawer and
full-screen phone view, this row stays above the scrolling transcript so it does
not cover messages. A short container temporarily compresses the artwork and
restores it when space returns. The animated face keeps its reserved artwork
area while you type or scroll; its animation does not change the size of the
message controls.

Main's microphone and speaker controls sit with the expanded face, outside the
original message buttons. Before speech is connected, the speaker button opens
Main's speech connection and changes spoken replies without recording.
Main defaults to spoken replies on when no choice is saved; Colleague defaults
off. An explicit saved choice takes precedence. A host with saved speech
preferences keeps the speaker choice personal and separate for Colleague and
coding assistants. Both idle controls stay available while
Talk is connecting. The fourth small round button, the minus after microphone,
speaker and settings, tucks away the face; speech continues. The collapsed anonymous icon in the
top-right corner is **Show avatar** and restores it. While hidden, a passive
**Listening** microphone appears only during unmuted capture, and a passive
**Speaking** speaker appears only while audio plays. These indicators are not
buttons; Show avatar is the only action in the collapsed row. Expand it to use
the voice controls. Speech review and errors remain visible.
For Main, switching to another browser tab cancels microphone startup or the
current unfinished recording. An earlier pending message and your typed draft
remain. Return and tap **Talk** to start recording again. New answers observed
while that tab is hidden are not spoken or replayed on return. Completed answers
already queued may finish when no recording is active. Hiding the avatar or
minimising chat does not trigger this browser-tab rule.
Main and Colleague have no chat reload button beside the avatar. Messages update
through the existing connection; Preview's reload control remains in Preview.
When changing voice targets, release Main's **Talk** button to finish its held
recording. Use **Stay here** to keep Main selected, or **Discard and switch**
to discard unfinished speech and change targets.

Main's original transcript shows accepted messages and answers, including when
sound is off. Both chats show unsent speech in a temporary user bubble until
admission. Your typed draft stays separate.

Automatic speech awaiting admission does not offer a manual Send button.
The temporary speech bubble has **Discard unsent message** (X) and **Edit unsent
message** (pencil). X removes only those unsent words. Edit opens **Review your
message** inside that same bubble, where you can change the words and use its
existing **Send** button. It keeps the original destination and message identity;
your typed message box stays unchanged, even if it contains a draft. Empty edits
stay visible, with Send disabled. Main edits through the same exact conversation access check as its voice
connection; an unavailable session cannot accept speech edits. Interrupted or failed recordings keep their
words and offer Send in the bubble; use the pencil to correct them before retrying.
A confirmed failed send retains its actual error in that bubble. Send retries its
original request. Explicit Edit clears that known local failure so the next Send
uses your corrected words as a newly authored request; it does not silently reuse
an old steering request. X also removes the associated known local failure.
If an earlier send fails while newer speech is recognized, both existing bubbles
stay visible. Recover the earlier bubble with its own Send, pencil or X. The
newer words keep their destination and identity and remain discardable; their
pencil becomes available after the earlier words are resolved. Editing the earlier
bubble pauses microphone capture without losing the newer words. Resolving it
releases that pause, unless you have since chosen a microphone state yourself.
The spoken answer and typed draft remain unchanged.
There is no second speech editor inside the typed composer.
These actions are unavailable while admission is being committed, sent or remains
uncertain. Edit pauses only capture while you review; the conversation, agent and
spoken reply continue. After Send or X resolves those words, hands-free capture
resumes through its existing controls. A recovered recording stays available until
you resolve it. After discarding an interrupted recording, tap **Talk** to start
a fresh recording. The discarded words are not sent or reused.
Holding the Colleague launcher opens a separate recording for review, requiring
explicit **Send**. You can listen while the assistant replies.
While live hands-free is on, you can type and send through the conversation's
ordinary Send/Steer controls while speech awaits admission or is being reviewed
in its separate bubble. Those controls still enforce the conversation's normal
send and queue limits. Startup, push-to-talk and one-off recordings or reviews
require resolution before a competing typed send. Unfinished speech still
protects target switching, and failed delivery retains its words for retry.

For a busy Main agent that cannot accept steering, completed spoken follow-ups
remain pending and send in order when the conversation becomes ready. Main's
message box offers **Send** for typed follow-ups to that same waiting conversation;
you can keep typing independently. **Stop agent work** remains available while
those follow-ups wait. Permitted native steering, including Codex, continues
immediately through **Steer**. A failed or uncertain request keeps its original intent;
retry never silently turns old steering into a new ordinary request.

Speech uses the conversation's existing model, permissions and tools. It starts
an ordinary request or steers permitted active work. Voice does not choose another
reasoning model. Colleague can explain these controls and carry out requests through
its existing actions; browser permission and recording gestures require you.

## Sound, voices and stopping

The microphone icon on **Talk / Pause** shows whether input is active. The speaker
icon shows whether spoken replies are enabled; select it to change that setting.
Input and output are independent: you can speak and read with sound off, or type
and hear replies with the microphone off. Typing, recording and ordinary steering
preserve the speaker choice and ongoing playback. If requested sound is blocked,
choose **Enable sound**; microphone capture remains independent.
**Stop … speaking** stops current and queued audio immediately. It remains quiet
until a fresh request or explicit read-aloud enable. **Stop agent work**, when present,
separately cancels the agent's work. The top-right **Close voice chat** X stops sound,
releases the microphone and closes the session without stopping agent work.
Closing discards unsent speech; your typed draft and saved messages remain.

## Face and speaking voice

Choosing the assistant's face and speaking voice is described in
[Assistant face and speaking voice](voice-face-and-speaking-voice.md).

## Navigate and switch targets

The top-right **Minimize conversation** minus hides the window while voice
continues. On desktop, clicking the header avatar while the window is open also
minimizes it. A badge on the header avatar shows the minimized session. Its microphone
symbol and ring indicate active listening; a headset indicates a retained session
that is not listening. Tap the avatar to reopen the same destination, or the
adjacent **Stop voice chat** X to stop audio without reopening it.
Navigate to another screen without redirecting the current recording.
Colleague keeps typing and speech in the same body. X, Escape, or an
outside click away from the header avatar closes the view and stops voice; use
minus or the avatar to keep listening.
Open voice for a different conversation to switch. Unfinished words require
completion or **Discard and switch**; **Stay here** keeps the original target.
There is only one voice window and one active capture/playback owner.

Lessons have no voice of their own: use Colleague's voice to learn with a
lesson.

Signing out, losing access to the target, or leaving the page releases its
resources. A project agent remains the selected voice target even if its text
view is no longer mounted; the retained voice window then shows recognized-word
and answer captions, without redirecting the conversation. Temporary and host-owned repair chats do not have a
project voice launcher.

Desktop and mobile use the same controls; the conversation fills the screen on
mobile. Colleague keeps messages, its model picker and typed composer together
with speech review and audio controls. Main's overlay stays fixed while its
original transcript scrolls. On short screens Colleague's artwork becomes
smaller. Minimize before using another page's controls; the dialog owns
focus while open.

For interrupted recognition, connection failure and saved speech-review settings,
see [Voice chat recovery](voice-recovery.md).
