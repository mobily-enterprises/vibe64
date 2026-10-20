// Workstream B stub of contract C1's installed v2 readLesson projection:
// { ...bundle, steps: [{ ...step, bodyText }], notesText?, visuals } with the
// raw lesson.json (schemaVersion 2, steps, no document/assessments) at
// `lesson`. It wraps a real installed v1 bundle so pins and hashes stay exact.
function asV2Lesson(lesson, { steps, checks = lesson.lesson.checks } = {}) {
  const { document: _document, assessments: _assessments, ...descriptor } = lesson.lesson;
  return {
    pin: lesson.pin, manifest: lesson.manifest, hash: lesson.hash, descriptorPath: lesson.descriptorPath,
    lesson: { ...descriptor, schemaVersion: 2, steps: structuredClone(steps), ...(checks ? { checks: structuredClone(checks) } : {}) },
    steps: steps.map(step => ({ ...structuredClone(step), bodyText: `# ${step.title}\n` })),
    visuals: lesson.visuals
  };
}

function v2Content(installed, options) {
  return {
    ...installed,
    async readLesson(input) { return asV2Lesson(await installed.readLesson(input), options); }
  };
}

export { asV2Lesson, v2Content };
