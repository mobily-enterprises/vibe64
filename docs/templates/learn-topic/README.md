# Copyable teaching topic template

This is a complete directory template for an **incomplete draft topic**. It has one draft lesson in lesson format v2 (schemaVersion `2`): optional notes and three steps — a reading step (`none`), a multiple-choice step (`choice`) and a learner-ticked step (`self`) — with no exercise, automatic check or visual. Do not teach it or mark it published before human review. Check verdicts are final: there is no rubric or AI grader, and Colleague never passes a step.

## Copy and adapt

1. Locate `docs/templates/learn-topic/` in your installed Vibe64 package or source checkout. Copy that entire directory, including `package.json` and `training/`, to a new writable directory such as `learn-my-topic`. For example, after substituting your actual source and destination paths:

   ```sh
   cp -R /absolute/path/to/vibe64/docs/templates/learn-topic /absolute/path/to/learn-my-topic
   ```

   Work in the copy. No dependency install or new application framework is needed for these content files.
2. In the copied `package.json`, replace `name` with your `learn-` repository name, `vibe64Training.topicId` with a permanent topic ID, `domainId` with the intended domain ID, and `title` with the topic title. Keep version `0.1.0`, the topic manifest's schemaVersion `1` and status `preview` while drafting (lessons declare their own schemaVersion `2`). IDs start with a letter, contain only letters, digits or hyphens, and have at most 64 characters.
3. Replace `TOPIC-01` with your permanent first lesson code: rename its directory and update the root manifest's `lessons[0].code` and `descriptor`, the lesson descriptor's `code`, the notes title and outline row. Keep the root entry `draft` and `required:true`.
4. Write the outline's learner, prerequisites, final ability and lesson outcomes. Replace `notes.md` and each `steps/*.md` body with real text a learner can follow without AI. Edit `steps` in `lesson.json`: each step has a unique `id`, `title`, `body`, `check` and `required`. Use `choice` (`question`, 2–8 `options`, `answer` as 0-based option indexes), `self` (learner ticks **Done**), `none` (reading only, never required) or `auto` (a declared check; needs an exercise). At least one step must be required. Optional `guide` points at a real Vibe64 place and optional `visual` plays declared commands; see `docs/training-content.md`.
5. To add lessons, copy the lesson directory to a new permanent code, update its code, title and steps, and append a `draft` entry with the correct descriptor path to the root manifest and outline. Declare earlier lesson prerequisites as `{ "code": "YOUR-01" }` and topic prerequisites as `{ "topicId": "another-topic" }`. Referenced lessons must exist, precede their dependants and have no cycles. A published lesson cannot require a draft lesson.
6. From the copied topic root, run the installed authoring command:

   ```sh
   vibe64 training validate .
   ```

   For a local bundle, choose a new output directory outside the topic:

   ```sh
   vibe64 training bundle . ../my-topic-preview-bundle
   ```

   Validation and bundling do not execute content, publish Git, install a topic or make drafts teachable. In a public Vibe64 development checkout, `node bin/run.js training ...` accepts the same arguments; run it from that checkout with the copied topic's absolute path.
7. Add an exercise, an `auto` step or a visual only when you have a real source and a working check. Follow the installed `docs/training-content.md` reference (section **Lesson format v2: steps**) for exercise/check/visual descriptors, exact relative paths and declared auxiliary `assets`. Never point a step body, notes, visual or exercise at `lesson.json`: it holds the choice answers and is refused. Do not add fake readiness or capabilities to make a draft appear runnable.
8. Trial and review the lesson with a human learner, including mistakes, assistance, recovery and relevant desktop/mobile controls. Only then change its root entry to `published`. Keep the topic `preview` until every required lesson is reviewed and published. A `released` topic cannot contain required draft lessons.

Before generating a course lock, add the real source repository as root `repository.url` in the format `https://github.com/<owner>/learn-<topic>.git`, commit the intended topic and leave it clean. Use the installed publishing guide for `vibe64 training publish-manifest`; local lock generation does not create or publish a remote repository. A course chooses this whole topic, not a subset of its lessons.
