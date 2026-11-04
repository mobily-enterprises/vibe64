/**
 * @typedef {object} AiTaskProblem
 * @property {string} key what makes this the same problem: the same key reopens the open task
 * @property {string} summary one line, shown in every view
 * @property {string} details what Details expands to
 * @property {object} facts what the kind's brief and check read
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
 *   | { effect: "check", id: string, reviewedConflictId: string, retryAi: boolean }
 *   | { effect: "interrupt", id: string }} AiTaskPending
 */

/**
 * @typedef {object} AiTask
 * @property {string} kind
 * @property {string} title
 * @property {"fix"|"task"} noun
 * @property {string[]} steps
 * @property {{ by: string, label: string, retryLimit: number }} check
 * @property {AiTaskTurn} turn
 * @property {string} doneMessage
 * @property {boolean} repository whether this task changes the repository: direct Update, Save and Prepare wait for it
 * @property {string} phase
 * @property {boolean} active
 * @property {string} reason
 * @property {string} message
 * @property {boolean} waiting whether a check waits for the session's assistant
 * @property {AiTaskProblem} problem
 * @property {object} input
 * @property {object | null} startedBy
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
 * @property {object} [facts] what a failed check learned, for the next try
 */

/**
 * @typedef {{ passed: true, message: string }
 *   | { passed: false, message: string, retryKey: string, diagnostic: string, facts?: object }
 *   | { waiting: true, message: string }} AiTaskCheckResult
 */

/**
 * @typedef {{ by: "agent" } | { by: "person" } | {
 *   by: "vibe64",
 *   label: string,
 *   run: (context: { runtime: object, sessionId: string, taskId: string }, task: AiTask) => Promise<AiTaskCheckResult>,
 *   retry: { limit: number, display: string, message: (diagnostic: string) => string }
 * }} AiTaskCheck
 */

/**
 * @typedef {object} AiTaskKind
 * @property {string} id
 * @property {string} title header, tray and outcome: "Fix Update"
 * @property {"fix"|"task"} noun "Cancel fix" or "Cancel task"
 * @property {"fix"|"inherit"} routing
 * @property {string} opening what the chat shows of the opening message
 * @property {string} busy why another task can't start while this one is open
 * @property {boolean} [repository]
 * @property {boolean} [updateRepair]
 * @property {(context: { runtime: object, sessionId: string }, input: object) => Promise<AiTaskProblem>} problem reads the real state
 * @property {(problem: AiTaskProblem) => string} brief what the AI is told first
 * @property {(problem: AiTaskProblem) => string} context reminder above each message the person sends
 * @property {string[]} steps
 * @property {AiTaskCheck} check
 * @property {string} done
 */

/** @typedef {ReturnType<typeof import("./service.js").createAiTasksService>} AiTasksService */

export {};
