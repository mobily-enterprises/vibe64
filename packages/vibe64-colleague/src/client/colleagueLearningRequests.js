import { watch } from "vue";

// Teach me in the Learning environment (L) asks this host's one Colleague to
// open and send L's fixed message. L only records the request; Colleague owns
// revealing its conversation and the ordinary send. A request for another
// signed-in person is never sent by this Colleague.
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
      await reveal();
      if (await send(value.message) === false) {
        throw new Error("Colleague could not receive Teach me. Open Colleague and ask it to teach this step.");
      }
    } catch (error) {
      report(error);
    } finally {
      if (running === request.id) running = "";
    }
  }, { immediate: true });
}

export { watchColleagueLearningRequests };
