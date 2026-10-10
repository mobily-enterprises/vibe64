# Talk with Colleague

Open Colleague with the header avatar. Desktop uses a 380-pixel right drawer
beside the mounted, usable workspace/Preview, without a backdrop. On phone it
fills the screen or hides behind its launcher. Messages, composer and optional
speech controls share one view, without Talk/Text tabs.
Opening starts neither microphone nor sound. Tap **Talk** for hands-free or
hold/release for push-to-talk; setup is automatic. Voice failure leaves typing available.
Chat/live updates use your Studio login. If it expires, sign in yourself and reopen;
check uncertain delivery before retrying. Colleague can explain the steps.
Replies default to one or two short sentences; ask for detail when needed.
Greetings get greetings; project/page details appear only when relevant.

The face starts at the message area's top right below the header, with Talk and
speaker beneath it. The row's round minus, **Minimise avatar**, hides face/controls
without stopping audio/work; the anonymous **Show avatar** icon restores them.
Messages scroll visibly behind its transparent space; short containers can shrink
the face. Hidden passive **Listening**/**Speaking** icons show unmuted capture/audio
separately. Only **Show avatar** is actionable there; expand for voice controls.
Speech review/retry remain visible independently.
The microphone and speaker are independent; recording does not turn spoken
replies on. Typing and ordinary steering preserve ongoing audio. During live
hands-free capture, typed composition and sending stay independent
of pending speech and its inline editor. One-off recording, push-to-talk and
startup still gate Send; your typed draft stays editable and separate. Minimizing
keeps voice active.
**Minimize conversation** (top-right minus) or the visible header avatar hides the
view. **Close** X or Escape inside chat stops voice and discards unsent speech.
Desktop workspace clicks leave the drawer open; minimizing/resizing retains draft,
history and unfinished words. While minimized, the header avatar's voice badge
uses a microphone/ring for listening. Tap it to reopen, or adjacent **Stop voice chat**
to stop audio without reopening or stopping agent work.
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

Type, then click **Send**. Tab from a nonempty draft moves to Send; Enter sends.
Typed and spoken follow-ups keep separate messages and their captured target.
Codex, Claude and OpenCode save accepted follow-ups while the response finishes.
New messages supersede proposed actions; actions already started are not undone.
With an API model, follow-ups stay **Pending** until ready, then send in order.
Speech uses the same conversation; queued messages stay separate.
**Stop** stops current work and waiting follow-ups;
saved messages remain. The message box keeps its original model button at the left and
Stop/Send controls at the right. Avatar and voice buttons are outside that toolbar;
showing or hiding the face does not rearrange the composer buttons.
Stop also works while Claude is starting. It cancels that startup without waiting
for the connection timeout. If cleanup cannot be confirmed, the error remains
visible and Stop can be retried; it does not claim that work has stopped.
Stopping Colleague leaves your other agent conversations running.
Minimizing or reopening the view does not itself stop a response.
The model picker is unavailable during a turn or while sending.
A completed reply returns the chat to ready and restores the model controls
through its live connection, without reloading the page.
Model changes keep saved messages and replies, including between native and API.
A changed engine, provider, model, agent or effort prepares the next conversation;
the same selection retains it. Applying starts no model work.
The new native conversation receives recent saved messages as excerpts of up to
2,000 characters each. Its 24-message window includes your current message,
leaving up to 23 earlier excerpts. Your full saved replies remain in the chat,
and your next message is sent in full.
If Colleague reports that its previous native turn must be stopped, click its
existing **Stop** control before selecting a model, including the same model.
A failed response can leave native cleanup unfinished; selecting a model does
not silently stop it or resend the request.
For native reply failures and AI setup errors, see
[Colleague delivery and recovery](colleague-recovery.md#failed-replies-and-setup).
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
If reopening reports another working directory or credential home, ask the
workspace operator to restore the original host configuration. Do not move native
history files or change accounts to bypass the warning. The shared driver can
resume a verified scoped Claude binding without creating another native thread;
it does not automatically recover bindings retired by an earlier application
upgrade. Those records need the operator's verified offline state upgrade.
If a model rejects a sent request, its error appears in the message box. Your
request remains in the conversation; this is separate from **Reconnecting…**,
which reports a failed connection check. Read the error before sending again.

Operating instructions survive follow-ups, tool checks, tool changes, compaction
and reconnect; no repetition or restart is needed. Current permissions govern
every action. After a failed connection check, inspect status before retrying;
uncertain tools are never automatically repeated. If requested by the error,
close the attached native assistant terminal before resuming.

If a requested view or diagram opens but its confirmation fails, leave it open
and ask Colleague to inspect its current state before asking for another change.
Rechecking the same pending confirmation keeps the original browser result; it
does not repeat the navigation or presentation command. Changing account retires
that pending confirmation rather than sending it as the new person.

Replies stream progressively; split characters wait for their remaining part,
without changing the final text. Hosted live updates/reconnect refresh retain
the conversation, expanded messages, completed replies and progress; interrupted
answers stay incomplete. Voice can speak growing readable phrases. Stop/new
steering clears unfinished output. Reopening reveals the current reply;
tool requests and arguments stay out of chat and older-message pages.

Completed replies are limited to 16,000 characters. Longer responses cannot be
saved as complete; streamed previews stay within that bound. Native models can
correct invalid responses automatically. If an error remains, ask for a shorter
answer. Your request stays in history and is not resent after failure. Application
actions retain their separate limits.

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
new steering clears old progress. The acknowledgement is temporary: the completed
answer enters saved history, while new progress text does not. Existing historical
messages remain unchanged. Native Codex can use its completed progress sentence
when that exact output was observed under the admitted request. An unfinished
sentence or an output without that verified request identity cannot supply it;
the normal fallback remains available. A late sentence from earlier steering
cannot become the current request's acknowledgement.
Progress over 280 characters is rejected before its action starts. Native models
can correct an invalid response automatically. If correction fails, your message
and history remain; read the error before retrying.
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
An operation-limit error keeps completed results; send a follow-up. Repeated
invalid responses keep your message; retry or choose another model after the
turn stops. This does not mean your projects are missing or your account disconnected.

Colleague can look up an operation and then carry it out within the same request.
Changing its focused project or switching between your request and background
observation requires a new lookup. Current permissions still apply: an earlier
lookup cannot make an operation available after access is removed.

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

## Ask Colleague to coordinate

For example: “Get the agent to implement password reset. Discuss its plan, let
it finish, arrange a review, and bring it back ready for my testing. You have eight
turns.” Colleague retains the original criteria, exact session and turn allowance.
It sends through the normal coding-agent operations, waits through code-driven
watches, and creates a reviewer in the same session after implementation settles.
The person does not have to choose Senior or Junior unless they have a preference.

Colleague can ask routine questions and request corrections within that assignment.
Consequential product decisions, expanded scope and extra turns need the person.
“Ready for testing” requires evidence against the original criteria and a review;
two agents agreeing that they are done is not sufficient.

Independent assignments can span projects and sessions. Explicitly tell Colleague
which assignments may exchange relevant findings; that permission does not merge
their source, make permission transitive or enlarge their budgets. Cancellation
of follow-through does not itself stop the coding agent. Request that stop separately.

You can also ask it simply to watch a conversation and tell you when the agent
answers. Such a watch authorizes reporting only, not sending further work.

For the coding chat's Send and Steer controls, see [Coding agents](coding-agents.md).
