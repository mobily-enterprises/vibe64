// Every word the AI task window says. Kinds supply their own title, steps and check wording.
const AI_TASK_MESSAGES = Object.freeze({
  actions: Object.freeze({
    aiSetup: "Open AI setup",
    answer: "Answer",
    back: "Back",
    cancel: "Cancel",
    cancelling: "Cancelling…",
    checkNow: "Check now",
    close: "Close",
    closing: "Closing…",
    continue: "Continue",
    details: "Details",
    endNotDone: "End as not done",
    finish: "Finish",
    hide: "Hide",
    keepGoing: "Keep going",
    openChat: "Open chat",
    review: "Review resolved conflicts"
  }),
  button: Object.freeze({
    busy: "Being fixed…",
    fix: "Fix it with AI",
    opening: "Opening…",
    result: "See result"
  }),
  chat: Object.freeze({
    answer: "Type your answer…",
    message: "Message the AI…"
  }),
  outcome: Object.freeze({
    backToResult: "Back to the result",
    done: "Done",
    notDone: "Not done",
    problem: "The problem",
    seeConversation: "See the conversation",
    whatHappened: "What happened",
    whatTheAiDid: "What the AI did",
    whatsNext: "What's next"
  }),
  progress: Object.freeze({
    activity: "Activity",
    unavailable: "Nothing is lost. The fix continues from here."
  }),
  rename: Object.freeze({
    heading: "Rename task",
    hint: "Leave it empty for the task's usual name.",
    label: "Task name",
    submit: "Rename"
  }),
  status: Object.freeze({
    aiStuck: "The AI could not finish this",
    aiUnavailable: "The AI account can't run this right now",
    cancelling: "Cancelling…",
    draftWaiting: "The check failed. Your unsent message is waiting.",
    interrupted: "Vibe64 restarted while the AI was working",
    noResult: "The AI stopped without saying it finished",
    question: "The AI needs your answer",
    starting: "Starting…",
    stopped: "Stopped. Tell the AI what to do next.",
    turnFailed: "The AI ran into an error",
    unconfirmed: "Vibe64 couldn't confirm the result",
    working: "The AI is working on this",
    yourTurn: "Your turn"
  }),
  tray: Object.freeze({
    cancelling: "Cancelling…",
    done: "Done",
    needsYou: "Needs you",
    notDone: "Not done",
    yourTurn: "Your turn"
  }),
  views: Object.freeze({
    chat: "Chat",
    label: "Task views",
    progress: "Progress",
    waiting: "The AI is waiting for your answer"
  }),
  closeFailed: "That didn't finish. Try again.",
  requestFailed: "That didn't reach Vibe64. Try again.",
  attempt: (attempt, limit) => `Attempt ${attempt} of ${limit}`,
  retrying: (attempt, limit) => `The AI is trying again (attempt ${attempt} of ${limit})`,
  cancelQuestion: noun => `Cancel this ${noun}? The AI stops. Anything it has changed stays in the session.`,
  cancelConfirm: noun => `Cancel ${noun}`,
  cancelledByYou: noun => `You cancelled this ${noun}.`,
  cancelledBy: (name, noun) => `${name} cancelled this ${noun}.`,
  renameTask: title => `Rename ${title}`,
  whatsNext: () => "The problem is still there. Anything the AI changed stays in the session. To try again, close this and choose Fix it with AI.",
  toast: (title, outcome) => `${title}: ${outcome}.`
});

export { AI_TASK_MESSAGES };
