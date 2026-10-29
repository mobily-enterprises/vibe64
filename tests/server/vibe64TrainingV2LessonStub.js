// Workstream B stub of contract C1's installed v2 readLesson projection:
// { ...bundle, steps: [{ ...step, bodyText }], notesText?, visuals } with the
// raw lesson.json (schemaVersion 2, steps, no document/assessments) at
// `lesson`. It wraps a real installed v1 bundle so pins and hashes stay exact.
// As in C1, a choice step's `answer` is stripped from every readLesson
// projection; only the server-only readChoiceAnswer returns it.
function withoutAnswer(step) {
  if (step.check?.kind !== "choice") return structuredClone(step);
  const { answer: _answer, ...check } = step.check;
  return { ...structuredClone(step), check: structuredClone(check) };
}

function asV2Lesson(lesson, { steps, checks = lesson.lesson.checks } = {}) {
  const { document: _document, assessments: _assessments, ...descriptor } = lesson.lesson;
  const projected = steps.map(withoutAnswer);
  return {
    pin: lesson.pin, manifest: lesson.manifest, hash: lesson.hash, descriptorPath: lesson.descriptorPath,
    lesson: { ...descriptor, schemaVersion: 2, steps: projected, ...(checks ? { checks: structuredClone(checks) } : {}) },
    steps: projected.map(step => ({ ...step, bodyText: `# ${step.title}\n` })),
    visuals: lesson.visuals
  };
}

function v2Content(installed, options) {
  return {
    ...installed,
    async readLesson(input) { return asV2Lesson(await installed.readLesson(input), options); },
    // As installed content does, the identity read names the same lesson
    // descriptor as readLesson, without its teaching bytes.
    async readAdmissionIdentity(input) {
      const identity = await installed.readAdmissionIdentity(input);
      return { ...identity, lesson: asV2Lesson(identity, options).lesson };
    },
    async readChoiceAnswer({ stepId, ...input } = {}) {
      const lesson = await installed.readLesson(input);
      const step = options.steps.find(value => value.id === stepId);
      if (step?.check?.kind !== "choice") throw new Error(`Step ${stepId} is not a choice step.`);
      return { pin: lesson.pin, lessonCode: lesson.lesson.code, lessonHash: lesson.hash, stepId, answer: [...step.check.answer] };
    }
  };
}

export { asV2Lesson, v2Content };
