import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { authenticatedVibe64User, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { requireTrainingMainTeacher } from "./teachingRole.js";
import { trainingPracticalProgressField, trainingPracticalField } from "../shared/practicalSchemas.js";

function createTrainingPracticalActions() {
  return [withVibe64ActionContext({ id: "vibe64.training.practical.read", version: 1, kind: "query", idempotency: "none",
    input: { mode: "create", schema: createSchema({ attemptId: {
      type: "string", required: true, noTrim: true, maxLength: 36,
      pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"
    } }) }, output: null,
    extensions: { assistant: { alwaysAvailable: true,
      description: "Read the original native practical collector for this exact delivered question and the browser that sent your current accepted learner message. Collecting steps are coaching facts, never an observation or pass: continue the remaining real controls without replacing the question. Completed facts provide the actual observation ID for practical.evaluate with this accepted explanation. You cannot choose another client, supply facts or paths, or count lesson admission/automatic selection as a learner action. Missing facts require truthful readiness/recovery guidance. Only original saved assessment progress establishes a pass.",
      output: { mode: "replace", schema: createSchema({ ok: { type: "boolean", required: true },
        trainingPracticalProgress: trainingPracticalProgressField, trainingPractical: trainingPracticalField }) }
    } },
    async execute(input, context) {
      if (!authenticatedVibe64User(context)) throw Object.assign(new Error("Sign in before reading lesson observations."), {
        code: "vibe64_auth_required", statusCode: 401 });
      const coordinator = requireTrainingMainTeacher(context, ["readTrainingPractical"]);
      return coordinator.readTrainingPractical(input, context);
    }
  }, { projectScoped: false, learningAccess: "observe" })];
}

export { createTrainingPracticalActions };
