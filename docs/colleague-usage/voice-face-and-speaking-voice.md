# Assistant face and speaking voice

This is part of [Voice chat with Colleague or a project agent](voice-chat.md).

## Choose the assistant's face

Colleague and the project agent show an illustrated face that blinks, moves and
animates its mouth while listening, thinking and speaking. Colleague starts with
**Merc · male**; project agents, including the Learning teacher, start with
**Yu · female**. To change one, open that assistant's **Voice settings** cog
beside the microphone and speaker controls (below its face when expanded) and
choose **Avatar**. Colleague and project agents keep separate choices. A project
agent's cog works without starting voice; Colleague shows its cog once its voice
controls are active (tap **Talk**). The face changes immediately, in the header
button, chat and voice window. On a phone the cog sits in the same row below
the face. Colleague can explain this but cannot choose for you: pick the
avatar yourself. In standalone Vibe64 the choice is saved in this browser only
(**Saved in this browser for this assistant type.**); another browser, a private
window or cleared site data starts again from the defaults. If browser storage
is blocked, the choice lasts until the page reloads.

## Choose a speaking voice

Open the same **Voice settings** cog and choose **Speaking voice**.
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
These activities use the same speaker and queue as answers. New messages wait
for the current message to finish; arriving progress or an answer does not cut off
spoken text. Repeated updates do not restart a message. The optional thinking
sound yields to a real answer. **Stop speaking**, turning off spoken replies and
switching voice targets still cancel playback.
Thinking and interim speech default off; thinking sounds default on. They follow
only the exact current, accessible Main view while the page is visible; hiding
the avatar does not disable them. Loading history primes the narrator rather
than replaying old activity. Turning off spoken replies silences all narration.
Choices and defaults come from the installed model pack and may include male and
female voices. If only one voice is installed it is shown but cannot be changed.
Server model setup is an operator task.

Loading **Speaking voice** performs a read-only, authorized catalogue check. It
does not start the microphone, open an audio connection or send an assistant
message. The app rechecks your current sign-in before showing installed choices.
If the catalogue cannot be loaded, sign in again if prompted, then close and
reopen **Voice settings** after the speech service has recovered; typed chat
remains available.

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
The default service preserves native handling of quiet input. An operator may
configure an input floor; if quiet words then fail to appear, move closer to the
microphone and ask the operator to review that setting. **Pause** retains captured
audio and finishes the final word; review the displayed words before retrying a
message that was already sent.
