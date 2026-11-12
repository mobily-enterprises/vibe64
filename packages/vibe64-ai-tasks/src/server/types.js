/**
 * @typedef {object} AiTaskProblem
 * @property {string} key what makes this the same problem: the same key reopens the open task
 * @property {string} summary one line, shown in every view
 * @property {string} details what Details expands to
 * @property {object} facts what the kind's brief and check read
 * @property {string} [title] names this task when its kind covers requests that read differently
 * @property {"fix"|"task"} [noun] the same, for Cancel's label
 * @property {string} [opening] the same, for the first message the person sees
 * @property {{ includeRecentChatContext?: boolean, assistantRouting?: object }} [conversation] how the task's
 *   conversation starts, for a kind that follows the starter's choices
 */

/**
 * What the AI's turn is told and how it is routed, saved on the task so
 * terminals prepares each turn without knowing any kind.
 * @typedef {object} AiTaskTurn
 * @property {string} context reminder placed above each message the person sends
 * @property {"fix"|"inherit"} routing "fix" requires Fix it with AI
 * @property {boolean} structured whether each turn asks for the task result schema
 * @property {boolean} updateRepair whether the turn's brief says Update owns the session
 */

/**
 * @typedef {{ effect: "send", id: string, message: string, display: string }
 *   | { effect: "check", id: string, reviewedConflictId: string, retryAi: boolean, whileAiWorks?: boolean }
 *   | { effect: "interrupt", id: string }} AiTaskPending
 */

/**
 * @typedef {object} AiTask
 * @property {string} kind
 * @property {string} title
 * @property {"fix"|"task"} noun
 * @property {string} tray what the app bar says while the task runs
 * @property {string[]} steps
 * @property {{ by: string, label: string, retryLimit: number, output: string, unstoppable: string,
 *   whileAiWorks: AiTaskWhileAiWorks | null }} check
 * @property {AiTaskTurn} turn
 * @property {string} doneMessage
 * @property {boolean} repository whether this task changes the repository: direct Update, Save and Prepare wait for it
 * @property {number} revision each change counts up, so a late answer never replaces a newer one
 * @property {string} phase
 * @property {boolean} active
 * @property {string} reason
 * @property {string} message
 * @property {boolean} waiting whether a check waits, for another change to the session or the main chat's AI
 * @property {string} mainChatSince while a check waits for the main chat's AI, when its turn started
 * @property {AiTaskCheckProgress | null} [progress] the step a running check last reported; none while it waits, and
 *   none on a task saved before checks reported steps
 * @property {AiTaskProblem} problem
 * @property {object} input
 * @property {object | null} startedBy
 * @property {string} diagnostic what the last failed check said, in its owner's words
 * @property {number} attempt
 * @property {string[]} retryKeys
 * @property {string} report
 * @property {AiTaskPending | null} pending
 * @property {string} turnMessageId the message whose turn this task waits for
 * @property {object | null} [cancelledBy]
 * @property {{ at: string, text: string }[]} log
 * @property {object | null} endedBy
 * @property {string} endedAt
 */

/**
 * @typedef {object} AiTaskEvent
 * @property {string} type
 * @property {string} at
 * @property {string} [id] the pending effect this event answers, or the new effect's stable id
 * @property {object | null} [by]
 * @property {string} [kind]
 * @property {string} [message]
 * @property {string} [report]
 * @property {string} [messageId]
 * @property {string} [retryKey]
 * @property {string} [retryMessage]
 * @property {string} [retryDisplay]
 * @property {string} [sendId]
 * @property {boolean} [hasDraft]
 * @property {string} [reviewedConflictId]
 * @property {boolean} [whileAiWorks] run a check waiting for the main chat's AI now
 * @property {string} [mainChatSince] when the main chat turn a check waits for started
 * @property {object} [facts] what a failed check learned, for the next try
 * @property {string} [step] the step a running check is on, in its owner's words
 * @property {string} [since] when that step started; empty: now, or when the same step was first reported
 * @property {string} [output] what that step has printed so far, as its owner may show it
 */

/**
 * The step a running check is on: its name, when it started and what it last printed. The window names the step,
 * times it from `since` and shows the output's last line.
 * @typedef {{ step: string, since: string, output: string }} AiTaskCheckProgress
 */

/**
 * Tells the task's viewers which step its check is on, as often as it likes: the runner saves the latest report,
 * one write at a time, and none after the check answers. It never throws and never waits.
 * @typedef {(update: { step: string, since?: string, output?: string }) => void} AiTaskCheckProgressReport
 */

/**
 * @typedef {{ passed: true, message: string }
 *   | { passed: false, message: string, retryKey: string, diagnostic: string, facts?: object }
 *   | { waiting: true, message: string, mainChatSince?: string }} AiTaskCheckResult
 */

/**
 * A check that waits for the main chat's AI offers to run now: the action's label and what the wait means.
 * @typedef {{ action: string, note: string }} AiTaskWhileAiWorks
 */

/**
 * A check that can stop passes `signal` on to its owner, which stops its run when Cancel aborts it and answers
 * how the run ended; one that can't stop says so in `unstoppable`, and Cancel waits for its answer.
 * @typedef {{ by: "agent" } | { by: "person" } | {
 *   by: "vibe64",
 *   label: string,
 *   output: string,
 *   unstoppable?: string,
 *   whileAiWorks?: AiTaskWhileAiWorks,
 *   run: (
 *     context: { progress: AiTaskCheckProgressReport, runtime: object, sessionId: string, signal: AbortSignal,
 *       taskId: string },
 *     task: AiTask
 *   ) => Promise<AiTaskCheckResult>,
 *   retry: { limit: number, display: string, message: (diagnostic: string) => string }
 * }} AiTaskCheck
 */

/**
 * @typedef {object} AiTaskKind
 * @property {string} id
 * @property {string} title header, tray and outcome: "Fix Update"
 * @property {"fix"|"task"} noun "Cancel fix" or "Cancel task"
 * @property {string} tray what the app bar says while the task runs
 * @property {"fix"|"inherit"} routing
 * @property {string} opening what the chat shows of the opening message
 * @property {string} busy why another task can't start while this one is open
 * @property {boolean} [repository]
 * @property {boolean} [updateRepair]
 * @property {(context: { runtime: object, sessionId: string, vibe64User: object | null }, input: object) => Promise<AiTaskProblem>} problem
 *   reads the real state; it refuses a person the task's own work is not open to
 * @property {(problem: AiTaskProblem) => string} brief what the AI is told first
 * @property {(problem: AiTaskProblem) => string} context reminder above each message the person sends
 * @property {string[]} steps
 * @property {AiTaskCheck} check
 * @property {string} done
 */

/** @typedef {ReturnType<typeof import("./service.js").createAiTasksService>} AiTasksService */

export {};
