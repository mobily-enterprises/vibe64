/**
 * @typedef {object} AiTaskPerson
 * @property {string} id
 * @property {string} name
 */

/**
 * What a browser sees of a task. The server moves it; the client only presents it.
 * @typedef {object} AiTask
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {"fix"|"task"} noun
 * @property {string} tray
 * @property {string[]} steps
 * @property {{ by: string, label: string, retryLimit: number, output: string, unstoppable: string }} check
 * @property {number} revision
 * @property {string} phase
 * @property {boolean} active
 * @property {string} reason
 * @property {string} message
 * @property {string} diagnostic what the last failed check said, in its owner's words
 * @property {boolean} waiting
 * @property {boolean} checkRunning
 * @property {{ key: string, summary: string, details: string }} problem
 * @property {string} conflictReview
 * @property {string[]} conflictPaths
 * @property {AiTaskPerson | null} startedBy
 * @property {AiTaskPerson | null} endedBy
 * @property {number} attempt
 * @property {string} report
 * @property {{ at: string, text: string }[]} log
 */

/**
 * @typedef {object} AiTaskAction
 * @property {string} id one of AI_TASK_ACTIONS
 * @property {string} label
 * @property {boolean} primary
 */

/**
 * @typedef {object} AiTaskStep
 * @property {string} label
 * @property {"pending"|"active"|"done"|"failed"} state
 * @property {string} attempt "Attempt 1 of 3" on the step that counts them
 */

/**
 * @typedef {object} AiTaskOutcome
 * @property {string} heading
 * @property {string} happened
 * @property {string} report what the AI did
 * @property {string} next what happens now, on Not done
 */

/**
 * What the window shows for a task, worked out in one place.
 * @typedef {object} AiTaskProjection
 * @property {"working"|"attention"|"turn"|"done"|"not-done"} glyph
 * @property {string} status
 * @property {string} tray
 * @property {boolean} ended
 * @property {boolean} chatDot whether the AI is waiting for an answer
 * @property {"progress"|"chat"} opensOn
 * @property {boolean} composerOpen whether a message can be sent now
 * @property {string} composerHint
 * @property {string} note the words under the steps
 * @property {AiTaskStep[]} steps
 * @property {AiTaskAction[]} actions the footer, empty outside `needs_you`
 * @property {string} cancelQuestion what Cancel asks before it ends the task
 * @property {AiTaskOutcome | null} outcome
 */

/**
 * One window's task and everything a person can do to it. A session's host supplies one, and a host
 * with a task of its own can supply another, so the window itself knows nothing about sessions or stores.
 * @typedef {object} AiTaskSource
 * @property {AiTask} task
 * @property {AiTaskProjection} projection
 * @property {boolean} open
 * @property {"progress"|"chat"} view
 * @property {boolean} cancelRequested a Cancel the server has not answered yet
 * @property {boolean} closing a Close the server has not answered yet
 * @property {boolean} transcriptOpen whether the outcome is showing the conversation instead
 * @property {string} error what the last request could not do
 * @property {(view: "progress"|"chat") => void} setView
 * @property {(open: boolean) => void} setTranscript
 * @property {() => void} hide
 * @property {() => Promise<void>} cancel
 * @property {() => Promise<void>} close
 * @property {(actionId: string) => void} run
 * @property {() => HTMLElement | null} returnFocusTarget
 */

/** @typedef {import("./useAiTaskHost.js").AiTaskHost} AiTaskHost */

export {};
