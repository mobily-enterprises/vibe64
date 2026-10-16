// Native paused status cannot establish whether the person requested Pause.
export default {
  id: "20261016-goal-continuation-intent",
  async run({ report }) {
    report("info", "New goal Set/Resume controls record durable continuation intent. Existing goals remain unchanged and are not automatically enrolled: explicitly Resume an intended goal once after this release. No historical pause intent or actor is inferred, and no application files require backup.");
  }
};
