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
not start recording or enable spoken replies. The message box has no separate
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
transcript. The face starts visible at the top edge of the message area, below
the header. After hiding it, the anonymous **Show avatar** icon reveals the
larger face, smaller microphone/speaker buttons and its settings cog. The small
round minus button at the end of that controls row tucks them away (accessible label
**Minimise avatar**). There is no size menu. Messages scroll behind the face itself, with
the space around it transparent. A short container temporarily compresses the
artwork and restores it when space returns.

Main's microphone and speaker controls sit with the expanded face, outside the
original message buttons. Before speech is connected, the speaker button opens
Main's speech connection and changes spoken replies without recording.
Main defaults to spoken replies on when no choice is saved; Colleague defaults
off. An explicit saved choice takes precedence. In Vibe64 Online, the speaker
choice is personal and separate for Colleague and coding assistants. Both idle controls stay available while
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
you resolve it.
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

Open this assistant's **Voice settings** cog beside the microphone and speaker
controls, below its face when expanded, then choose **Speaking voice**.
Opening settings loads the installed choices without recording. The
change applies to the next spoken reply. In standalone Vibe64 it lasts for the
current voice session; a host with saved speech preferences can replace this
selector and retain the choice across sessions. Vibe64 Online saves your avatar
and voice personally, separately for Colleague and coding assistants across
projects. Its Management → **Speech and Colleague** page changes only the shared
Colleague name; use each assistant's cog for your own avatar and voice.
The personal cog's **Speak replies** choice controls output for that target.
In Vibe64 Online, older browser-only speaker choices are not copied into personal
settings; check **Speak replies** when first using your personal controls.
While that choice saves, the speaker control briefly waits; microphone capture
and typed chat remain available.
For coding assistants, **Read thinking**, **Read progress** and **Thinking sounds**
also select optional thinking, interim work and a short sound while working.
These activities use the same speaker and queue as answers.
Thinking and interim speech default off; thinking sounds default on. They follow
only the exact current, accessible Main view while the page is visible; hiding
the avatar does not disable them. Loading history primes the narrator rather
than replaying old activity. Turning off spoken replies silences all narration.
Choices and defaults come from the installed model pack and may include male and
female voices. If only one voice is installed it is shown but cannot be changed.
Server model setup is an operator task.

Answers start speaking in short phrases before completion; code and dense tables
remain in chat. Spoken answers use up to 4,000 characters after removing code and
formatting from the first 8,000 characters of the answer. A long code block within
that window leaves room to speak the explanation after it. Read the chat for the
rest of a longer answer; reaching the speech limit does not mean the agent has
finished. Existing history is not replayed when the window opens. Spoken
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
Colleague keeps typing and speech in the same body. X, Escape, or an
outside click away from the header avatar closes the view and stops voice; use
minus or the avatar to keep listening.
Open voice for a different conversation to switch. Unfinished words require
completion or **Discard and switch**; **Stay here** keeps the original target.
There is only one voice window and one active capture/playback owner.

On installations with speech configured, a source-less Learning conversation
uses Main's same microphone, spoken replies and review controls; it does not
require an invented project. Its voice target is labelled **Lesson** and the
actual conversation name. Capture stays attached to that person's saved attempt
and conversation. Switching attempts does not resend or redirect words. Reading
lesson history does not authorize new teaching work: each Send still checks the
current saved lesson and access. Without a speech service, use the same typed
Main conversation; voice availability is optional.

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
