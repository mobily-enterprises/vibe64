# Talk with Colleague

Open Colleague with its avatar button in the page header. On desktop it opens a
380-pixel drawer on the right, beside the workspace or Preview. The workspace
stays mounted and usable in the remaining space; there is no dimmed backdrop.
On a phone, the same conversation fills the screen or hides behind its launcher.
Messages, the typed composer and optional speech controls appear together,
without Talk/Text tabs.
Opening does not start the microphone or enable sound. Tap **Talk** for hands-free,
or hold it and release for push-to-talk; connection setup is automatic.
Typed chat remains available if voice setup fails.
Colleague uses your current Studio login for chat and live updates. If the login
expires, sign in again and reopen Colleague; check any uncertain delivery before
retrying. Colleague can explain the steps, but you must sign in yourself.
Colleague replies briefly by default, usually one or two short sentences.
Ask for a detailed explanation when you want more. A greeting gets a greeting;
project/page details appear only when relevant.

The conversation starts with its face and voice buttons visible at the top right
of the message area, immediately below the header. Talk and the speaker control
sit below the face. The small round minus at the end of that control row
(accessible label **Minimise avatar**) removes the face and its controls without
stopping audio or work. The anonymous **Show avatar** icon at
the top right reopens it. Messages remain visible while they scroll behind the
transparent space around the face. A short container can temporarily shrink it.
While hidden, passive **Listening** and **Speaking** icons show unmuted capture
and active audio separately. They are not buttons; **Show avatar** is the only
action in that row. Expand it to use the voice controls. Speech review and retry
stay visible independently of the face.
The microphone and speaker are independent; recording does not turn spoken
replies on. Typing and ordinary steering preserve ongoing audio. During live
hands-free capture, typed composition and sending stay independent
of pending speech and its inline editor. One-off recording, push-to-talk and
startup still gate Send; your typed draft stays editable and separate. Minimizing
keeps voice active.
The top-right **Minimize conversation** minus hides the view;
clicking the visible header avatar also minimizes. **Close** X stops voice;
Escape while focused inside the conversation also closes it. Clicking the desktop
workspace leaves the drawer open. Draft, history and unfinished words stay when
you minimize or resize; Close explicitly discards unsent speech.
While minimized, a badge on the header avatar shows voice; a microphone and ring
mean it is listening. Tap the avatar to reopen, or its adjacent **Stop voice chat**
button to stop audio without reopening or stopping the agent's work.
See [Voice chat](voice-chat.md) for recording, sound, target switching and recovery.

The temporary speech bubble has **Discard unsent message** (X) and **Edit unsent
message** (pencil). X removes only those unsent words. Edit opens an editor inside
the same speech bubble, preserving its identity and focus. The existing Send
control sends the reviewed words; your separate typed draft stays untouched.
An uncertain speech message cannot be edited, discarded or resent. A newer
known-unsent bubble can still be discarded with its own X. To become idle before
starting fresh, pause the microphone first, then discard that newer bubble.
Pausing alone retains its capture and words. Edit of a definite failed submission
retires its rejected local request so the next explicit Send uses the edited
text and current intent; plain Retry keeps the original request.
These actions remain guarded during admission and sending. Taking current words
may restart hands-free capture unless the microphone was paused. Recovery does
not stop the existing spoken reply or replace your typed draft.

Type in the message box, then click Send. With a nonempty draft, Tab moves
directly from the text field to Send and Enter sends the message. While Colleague
is working, you can send typed or spoken follow-ups. They show as pending and
wait for the current turn to finish before being sent, in order, preserving its
current answer and ongoing spoken reply. Send keeps the text and the page or conversation you were viewing;
later navigation does not redirect a pending request. Colleague shows Send.
Stop explicitly stops its current turn and cancels
locally waiting follow-ups before they are sent. The message box keeps its original model button at the left and
Stop/Send controls at the right. Avatar and voice buttons are outside that toolbar;
showing or hiding the face does not rearrange the composer buttons.
Stopping Colleague leaves your other agent conversations running.
Minimizing or reopening the view does not itself stop a response.
The model picker is unavailable during a turn or while sending.
Changing its selection keeps this conversation and its saved replies. A changed
engine, provider, model, agent or effort starts a fresh native conversation for
the next message; choosing the same selection retains the current one. Applying
the selection does not send a message.
If Colleague reports that its previous native turn must be stopped, click its
existing **Stop** control before selecting a model, including the same model.
A failed response can leave native cleanup unfinished; selecting a model does
not silently stop it or resend the request.
If Codex reports a failure without a final reply, Colleague checks that exact
request's saved native history. A completed answer is recovered once. Otherwise
Colleague reports the failure and stops the failed native turn through its
existing cleanup. If cleanup cannot be confirmed, use **Stop** before continuing.
This recovery does not resend your request or use another turn's answer.
If a failed or interrupted Codex status arrives before its error detail,
Colleague briefly waits for that detail before reporting the failure. A following
error is reported immediately. Repeated status does not extend the wait, and
pressing **Stop** does not wait for an error detail.
If Codex finishes without delivering answer text, Colleague briefly checks for
that exact reply, then reports missing output instead of waiting indefinitely.
A slow first history check does not consume its brief wait for a late reply.
Your message remains in history; this check does not send it again.
This also applies when selecting a connected provider under OpenCode. Vibe64
hands the retained chat context to that provider without starting a fresh
Colleague chat or resetting your lesson. A pending delivery keeps its original
receipt; changing provider does not automatically resend it.
Opening the conversation or reviewing earlier replies does not send a message or start work.
If a message cannot be saved, sending fails before Colleague starts that request.
Restore workspace storage, then retry; an unsaved message is not treated as an
accepted request.
If the service stops while preparing a message, before sending it, the message
remains unsent. Retry after the service is available again.
For **Check delivery**, **Start fresh**, **Previous conversations** and retained
drafts, see [Colleague delivery and recovery](colleague-recovery.md). Recovery
never automatically resends an unconfirmed message.

Colleague prepares its selected native assistant and checks its connected account
without requiring an open project. A host execution error during preparation
does not by itself mean that account is disconnected. Ask the workspace operator
to restore execution, then retry in the same conversation. Use **AI Accounts**
to reconnect only when the account check asks you to sign in.
Colleague uses the same saved native Claude login as Main. Opening Colleague
does not move that login to another profile or require a separate sign-in.
If a model rejects a sent request, its error appears in the message box. Your
request remains in the conversation; this is separate from **Reconnecting…**,
which reports a failed connection check. Read the error before sending again.

Colleague keeps its operating instructions across follow-up questions and tool
checks. You do not need to repeat them or restart the conversation when its
available product tools change. Current permissions still apply to each action.
The same instructions remain available after the assistant compacts its context
or reconnects. If a connection check fails, inspect the reported status before
retrying an action; Colleague does not automatically repeat an uncertain tool
operation. If the error asks you to close an attached native assistant terminal,
close it before resuming the conversation.

If a requested view or diagram opens but its confirmation fails, leave it open
and ask Colleague to inspect its current state before asking for another change.
Rechecking the same pending confirmation keeps the original browser result; it
does not repeat the navigation or presentation command. Changing account retires
that pending confirmation rather than sending it as the new person.

Reply text appears progressively while Colleague is answering. A character split
across updates appears only after its remaining part arrives; the completed reply
is unchanged. Hosted clients
receive live updates and refresh the conversation after reconnecting. Completed replies and
progress are retained; an interrupted answer is not shown as a completed reply. Live updates and refreshes keep the same conversation and expanded
messages in place; a voice-enabled host can begin speaking readable phrases while the
answer is still growing. Stop or new
steering clears the unfinished reply. Reopening the drawer while it is working
shows the current reply again. Tool requests are not displayed as chat text.

Colleague accepts completed replies up to 16,000 characters. A longer reply
reports a failure instead of silently cutting the answer short or saving it as
complete. Your request remains in history. Read the error, then ask for a shorter
answer; the failed request is not automatically sent again. This reply limit
does not reduce the separate limits for supported application actions.

If updates cannot reconnect, the compact chat warning retains already loaded
history and your draft. Use **Reload chat** in that warning to observe the same
conversation again; it does not resend a message. A connection warning does not
prove that Colleague has stopped working. If access is denied, cached content is
cleared and the recovery button is hidden. Sign in with the authorized account
and reopen Colleague. These controls also apply to the full-screen phone chat.

When a question needs a lookup or another product action, Colleague can show
and speak a short progress sentence before its final answer. Each is spoken once;
finishing and saving the answer does not replay its opening words. Progress describes
what it is checking; it is not confirmation that an action succeeded. Stop or
new steering clears old progress.
For an API-based Colleague, progress longer than 280 characters fails the response
before its requested action starts. The message and history stay available for a
follow-up. This bound currently applies only to the API integration; equivalent
native Codex, Claude and OpenCode progress protection remains unfinished.
If no progress sentence is available when the first action starts, Colleague says
“Let me check that.” The first acknowledgement stays available during the lookup,
including when you reopen the conversation, until the answer replaces it.
Background monitoring does not speak an interactive lookup acknowledgement.
Its completed notification can still be spoken when sound is on. A saved notice,
“An update from your watched conversations.”, appears before the completed answer,
including after reopening. Internal watch instructions and tool arguments stay hidden.

Ask “Tell me when that agent replies, even while it keeps working” to request a
response watch. Colleague can watch the exact Main or temporary conversation and
report its next completed message, including a progress reply during an active
goal. Partial words, thinking and tool output do not trigger it. A reply does not
mean the task is done: Colleague reports what the agent actually said and whether
work continues. Ask for an ongoing watch to receive later responses too; a
one-shot watch ends after its first delivered report. Ask “Tell me when the work
finishes” for a completion watch instead. Watching starts only on your request,
checks your current project access and does not stop or resend the coding work.

Use the eye-and-count **Watches and assignments** button beside Previous
conversations to inspect ongoing work. It opens a separate view; nothing is
listed below chat. **Resume** restarts a paused watch, and **Cancel** removes its
watch without stopping the agent. Close this view to return to the same chat and
draft. On phone, use **Close watches and assignments** in its header. Ask
Colleague to list, cancel or resume watches if you prefer.

You can ask “Which projects do I have?” from any page, including AI Accounts;
no open project is required. Colleague checks the projects available to you.
A malformed lookup returns a validation error. An unavailable tool runs no action;
Colleague receives its verified refusal and can give a final reply. A provider failure
or uncertain operation stops the turn. Your request is retained. Read the reported error and
inspect the action's target before trying again; you can select another model
once the turn has stopped. If a model change was interrupted, select that same
model again to finish the change before sending another message.
This error does not mean your projects are missing or your account disconnected.

Recognized words can appear as a Pending user message in chat; acceptance replaces
it with the saved message once. Unsent or discarded words are not saved history.
Review and recording controls live beside the same typed composer. Microphone permission
and recording require your interaction; Colleague can explain the steps but cannot
grant permission or press them for you.

After an application upgrade, an older Colleague history may require the
installation's state upgrade before it can open. The workspace operator runs the
candidate release's upgrade command with services stopped; Colleague cannot do
this through chat. Written history is preserved, and interrupted operations are
not repeated.

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
