// A session's agent run kept every event of the session's whole life, so each
// open or reload of the session read, parsed and sent them all, and each event
// rewrote them all: at 100 stored turns about 100 times what one turn costs. A
// run now keeps the events of its last two turns, and the turns before them
// move to its history beside it (agent-runs/<run id>.history.jsonl), which no
// session read opens; a new turn moves them from then on. This upgrade moves
// them in the runs earlier releases grew. Nothing is deleted. Runtime owns the
// session records and the format; the candidate CLI supplies the operation.
export default {
  id: "20261125-agent-run-history",
  async run({ upgradeAgentRunHistory, ...context }) {
    if (typeof upgradeAgentRunHistory !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session record owner is required.");
    }
    await upgradeAgentRunHistory(context);
  }
};
