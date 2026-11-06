// Connected repositories became per-session copies that Prepare makes, so the
// session links they replaced are deleted from every active session with its
// cached update check, after a backup; a former consumer's preparation is
// needed again. No files move and nothing touches the network. Runtime owns the
// session records; the candidate CLI supplies the operation.
export default {
  id: "20261106-connected-repository-copies",
  async run({ removeConnectedSessionLinks, ...context }) {
    if (typeof removeConnectedSessionLinks !== "function") {
      throw new Error("Use the candidate upgrade-state command; the session record owner is required.");
    }
    await removeConnectedSessionLinks(context);
  }
};
