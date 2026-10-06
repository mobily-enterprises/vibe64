# Talk with Colleague

Open Colleague with its avatar button in the page header. **Talk** opens first;
choose **Text** at the top for written chat. Both use the same conversation and
preserve your typed draft. Opening Talk does not start the microphone: choose
tap **Talk** for hands-free, or hold it and release for push-to-talk.
Connection setup is automatic.
Colleague uses your current Studio login for chat and live updates. If the login
expires, sign in again and reopen Colleague; check any uncertain delivery before
retrying. Colleague can explain the steps, but you must sign in yourself.
Colleague replies briefly by default, usually one or two short sentences.
Ask for a detailed explanation when you want more. A greeting gets a greeting;
project/page details appear only when relevant.

**Talk / Text** stays in the same place in both views, without a slide animation.
Both views use the same size and fill the screen on mobile. Text has no portrait
and uses the available height for messages. Selecting Text or minimizing keeps
voice active. The top-right **Minimize conversation** minus hides the view;
clicking the visible header avatar also minimizes. **Close** X stops voice, as do
Escape and outside clicks away from the avatar. Draft and history stay.
While minimized, a badge on the header avatar shows voice; a microphone and ring
mean it is listening. Tap the avatar to reopen, or its adjacent **Stop voice chat**
button to stop audio without reopening or stopping the agent's work.
See [Voice chat](voice-chat.md) for recording, sound, target switching and recovery.

In Text, type in the message box, then click Send. With a nonempty draft, Tab moves
directly from the text field to Send and Enter sends the message. While Colleague
is working, the same shortcut uses Steer to add instructions. Stop stops its
current turn. These controls and the model picker sit inside the message box.
Stopping Colleague leaves your other agent conversations running.
Steer stops the current response before processing your new instruction. It uses
the page or conversation you were viewing when you sent that instruction;
subsequent navigation does not redirect it. Minimizing or reopening the view
does not itself stop a response.
The model picker is unavailable during a turn or while sending.
Changing its selection keeps this conversation and its saved replies. The next
message uses the chosen model; applying the selection does not send a message.
Opening Text or reviewing earlier replies does not send a message or start work.
If a message cannot be saved, sending fails before Colleague starts that request.
Restore workspace storage, then retry; an unsaved message is not treated as an
accepted request.
If the service stops while preparing a message, before sending it, the message
remains unsent. Retry after the service is available again.
If the first message needs model setup, the draft stays in the message box.
Complete that setup, then send it again. If delivery is uncertain, use **Check
delivery** before retrying; reconnecting does not automatically send it twice.
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

Reply text appears progressively while Colleague is answering. Hosted clients
receive live updates and refresh the conversation after reconnecting. Completed replies and
progress are retained; an interrupted answer is not shown as a completed reply. Live updates and refreshes keep the same conversation and expanded
messages in place; a voice-enabled host can begin speaking readable phrases while the
answer is still growing. Stop or new
steering clears the unfinished reply. Reopening the drawer while it is working
shows the current reply again. Tool requests are not displayed as chat text.

When a question needs a lookup or another product action, Colleague can show
and speak a short progress sentence before its final answer. Each is spoken once;
finishing and saving the answer does not replay its opening words. Progress describes
what it is checking; it is not confirmation that an action succeeded. Stop or
new steering clears old progress.
If no progress sentence is available when the first action starts, Colleague says
“Let me check that.” The first acknowledgement stays available during the lookup,
including when you reopen the conversation, until the answer replaces it.
Background monitoring does not speak an interactive lookup acknowledgement.
Its completed notification can still be spoken when sound is on. Internal watch
instructions and tool arguments are not conversation messages.

You can ask “Which projects do I have?” from any page, including AI Accounts;
no open project is required. Colleague checks the projects available to you.
A malformed lookup returns a validation error. An unavailable tool or uncertain
operation stops the turn. Your request is retained. Read the reported error and
inspect the action's target before trying again; you can select another model
once the turn has stopped. If a model change was interrupted, select that same
model again to finish the change before sending another message.
This error does not mean your projects are missing or your account disconnected.

Recognized words can appear as a Pending user message in chat; acceptance replaces
it with the saved message once. Unsent or discarded words are not saved history.
Review and recording controls live in the shared voice window. Microphone permission
and recording require your interaction; Colleague can explain the steps but cannot
grant permission or press them for you.

After an application upgrade, an older Colleague history may require the
installation's state upgrade before it can open. The workspace operator runs the
candidate release's upgrade command with services stopped; Colleague cannot do
this through chat. Written history is preserved, and interrupted operations are
not repeated.
