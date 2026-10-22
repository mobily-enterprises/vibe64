import { watch } from "vue";

// Teach me (and I'm stuck) on a lesson step asks this host's one Colleague to
// open and send the step's fixed message; a lesson beat's open request only opens it. Learning only records the request; Colleague owns
// revealing its conversation (refreshed first, so it is the lesson's Learn
// thread) and the ordinary send. A request for another signed-in person is
// never sent by this Colleague.
function watchColleagueLearningRequests({ learning, actorKey, reveal, send, report }) {
  if (!learning?.colleagueRequest || typeof learning.consumeColleagueRequest !== "function") return () => {};
  let running = "";
  return watch(() => learning.colleagueRequest.value, async request => {
    if (!request?.id || running === request.id) return;
    if (request.actorKey && request.actorKey !== actorKey()) return;
    running = request.id;
    try {
      // Consumed once: a failure is reported and Teach me can be pressed again.
      const value = learning.consumeColleagueRequest(request.id);
      if (!value) return;
      // reveal() returning false means Colleague cannot answer (no usable AI
      // model): it has said so in its conversation and nothing is sent.
      if (await reveal() === false) return;
      // open: a lesson's Do it for me opens Colleague and sends nothing.
      if (value.kind === "open") return;
      if (await send(value.message) === false) {
        throw new Error(value.kind === "stuck" ? "Colleague could not receive I'm stuck. Open Colleague and tell it where you are stuck."
          : "Colleague could not receive Teach me. Open Colleague and ask it to teach this step.");
      }
    } catch (error) {
      report(error);
    } finally {
      if (running === request.id) running = "";
    }
  }, { immediate: true });
}

export { watchColleagueLearningRequests };
