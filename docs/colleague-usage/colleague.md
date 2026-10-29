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
Message timestamps include the calendar date and time in your browser's local
timezone, on desktop and phone.

The face starts at the message area's top right below the header, with Talk and
speaker beneath it. The row's round minus, **Minimise avatar**, hides face/controls
without stopping audio/work; the anonymous **Show avatar** icon restores them.
Colleague remembers your last choice and starts that way after a reload.
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
saved messages remain. Stop is saved even when a summary Helper cannot be
closed yet; its error names that Helper and its reason, and the next summary
retries closing it. The message box keeps its original model button at the left and
Stop/Send controls at the right. Avatar and voice buttons are outside that toolbar;
showing or hiding the face does not rearrange the composer buttons.
Stop also works while Claude is starting. It cancels that startup without waiting
for the connection timeout. If cleanup cannot be confirmed, the error remains
visible and Stop can be retried; it does not claim that work has stopped.
Stopping Colleague leaves your other agent conversations running.
Finishing, restarting, archiving or deleting a lesson stops its teacher's reply.
Minimizing or reopening the view does not itself stop a response.
The model picker is unavailable during a turn or while sending.
A completed reply returns the chat to ready and restores the model controls
through its live connection, without reloading the page.
If no usable model is connected yet, Colleague shows a warning as soon as you
open it (or after your first request) that nothing is sent and your draft is
kept. Choose **Set up your AI** to open the guided AI setup, which recommends a
provider, opens its sign-up page and connects it, then switches Colleague to that
AI's Senior model. Then return and press **Send**. Opening setup does not send the draft or
promise a response from an unavailable model. Credential entry and provider
consent remain your actions.
Colleague starts on the Colleague model of your setup in **Models** (see
[AI model setups](ai-model-setups.md)): the owner's follows Senior unless the
owner chose another; team members start on the team setup's Colleague model.
Each person can pick their own model from Colleague's model menu, which lists
only models they may use (team members never see personal plans). Your pick is
yours alone and does not change Models or anyone else's Colleague.
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
For **Retry**, **Start fresh**, **Previous conversations** and retained
drafts, see [Colleague delivery and recovery](colleague-recovery.md). Recovery
never automatically resends an unconfirmed message.

Colleague's conversation follows your mode: Develop has your one conversation,
and in Learn mode each lesson has its own teacher conversation (see
[Lessons: Colleague teaches](learning-with-colleague.md)). Pressing **L** shows
the other mode's conversation; nothing is lost or interrupted.

Colleague prepares its selected native assistant and checks its connected account
without requiring an open project. A host execution error during preparation
does not by itself mean that account is disconnected. Ask the workspace operator
to restore execution, then retry in the same conversation. Use **AI Accounts**
to reconnect only when the account check asks you to sign in.
Colleague uses the same saved native Claude login as Main. Opening Colleague
does not move that login to another profile or require a separate sign-in.
Changing the workspace Claude account (signing in, signing out or **Remove AI**)
stops Colleague's Claude process right away, including an answer in progress.
Your next Colleague request opens a new process on the current account and keeps
the conversation history. If Colleague cannot stop its process, the account
change is refused with that reason and the account stays as it was; restore execution and use
**Stop**, then retry the account change. Colleague will not continue with the old
credentials. A completed action receipt
from the old account cannot be replayed as the new account.
Saved Colleague errors stay inside Colleague when you reopen the workspace; they
do not raise an unrelated global alert over your project chat. Open Colleague to
read the error and its recovery controls.
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
While the warning is present, the avatar and its controls move above the messages
to leave the text and **Reload chat** reachable. This temporarily leaves less
visible history; clearing the warning restores the floating avatar without
changing its size preference, loaded messages or your draft.
Scroll chat if a short phone view cannot fit the warning and composer together.

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
“An update from what you asked Colleague to watch.”, appears before the completed answer,
including after reopening. Internal watch instructions and tool arguments stay hidden.

For response watches, watching more than conversations (such as a
project's publication), Learning observation and recorded action outcomes, read
[Colleague watches and operations](colleague-watches.md).

## Colleague outside projects

Colleague works on every screen, not only inside a project: the account menu,
AI setup, Courses and any other screen outside your projects. Ask how to do
something there and it reads this release's guide first. If one guide in this
release is too large or cannot be read, Colleague tells you that topic is
unavailable instead of guessing its steps, and still uses every other guide.
Ask “Show me where…” and it points at the place, or opens it when you ask it
to; it only offers places this Vibe64 has and that you may use. It can watch what this Vibe64
lets it watch for you. A studio lesson's step bar points at the same places.

Recognized words can appear as a Pending user message in chat; acceptance replaces
it with the saved message once. Unsent or discarded words are not saved history.
Review and recording controls live beside the same typed composer. Microphone permission
and recording require your interaction; Colleague can explain the steps but cannot
grant permission or press them for you.

After an application upgrade, an older Colleague history may require an operator
state upgrade before it can open. Written history is preserved; interrupted work
is not repeated. See [Colleague upgrade recovery](colleague-upgrade-recovery.md).

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
