/**
 * What every concern of one Colleague service shares and changes: whether the
 * service closed, and its threads with the browsers and visible thread of each
 * person.
 */
function createColleagueServiceState() {
  return Object.freeze({
    lifecycle: Object.seal({ closed: false }),
    // The thread that owns each conversation runtime id.
    conversationOwners: new Map(),
    // One state per conversation thread (Develop, or a Learn thread), keyed by
    // its owner key. A person's browsers are shared by their threads, and only
    // the visible thread has a live runtime.
    users: new Map(),
    browsers: new Map(),
    visible: new Map(),
    // Released attempt threads never reopen: their file belongs to Training.
    releasedThreads: new Set()
  });
}

export { createColleagueServiceState };
