# Copyable teaching topic template

This is a complete directory template for an **incomplete draft topic**. It has one draft answer-based lesson and no exercise, executable check or visual. Do not teach it, award progress from its placeholder rubric, or mark it published before human review.

## Copy and adapt

1. Locate `docs/templates/learn-topic/` in your installed Vibe64 package or source checkout. Copy that entire directory, including `package.json` and `training/`, to a new writable directory such as `learn-my-topic`. For example, after substituting your actual source and destination paths:

   ```sh
   cp -R /absolute/path/to/vibe64/docs/templates/learn-topic /absolute/path/to/learn-my-topic
   ```

   Work in the copy. No dependency install or new application framework is needed for these content files.
2. In the copied `package.json`, replace `name` with your `learn-` repository name, `vibe64Training.topicId` with a permanent topic ID, `domainId` with the intended domain ID, and `title` with the topic title. Keep version `0.1.0`, schemaVersion `1` and status `preview` while drafting. IDs start with a letter, contain only letters, digits or hyphens, and have at most 64 characters.
3. Replace `TOPIC-01` with your permanent first lesson code: rename its directory and update the root manifest's `lessons[0].code` and `descriptor`, the lesson descriptor's `code`, the Markdown title and outline row. Replace the lesson title in both its descriptor and teaching document. Keep the root entry `draft` and `required:true`.
4. Write the outline's learner, prerequisites, final ability and lesson outcomes. Replace the lesson document's planning text with explanations, demonstrations, learner tasks, a real passing rubric, hints, misconceptions and recovery. The descriptor's `explain-outcome` assessment must still refer to the exact standalone `<a id="explain-outcome"></a>` anchor as `lesson.md#explain-outcome`. If you rename the assessment, change all three references together.
5. To add lessons, copy the lesson directory to a new permanent code, update its code/title/anchors, and append a `draft` entry with the correct descriptor path to the root manifest and outline. Declare earlier lesson prerequisites as `{ "code": "YOUR-01" }` and topic prerequisites as `{ "topicId": "another-topic" }`. Referenced lessons must exist, precede their dependants and have no cycles. A published lesson cannot require a draft lesson.
6. From the copied topic root, run the installed authoring command:

   ```sh
   vibe64 training validate .
   ```

   For a local bundle, choose a new output directory outside the topic:

   ```sh
   vibe64 training bundle . ../my-topic-preview-bundle
   ```

   Validation and bundling do not execute content, publish Git, install a topic or make drafts teachable. In a public Vibe64 development checkout, `node bin/run.js training ...` accepts the same arguments; run it from that checkout with the copied topic's absolute path.
7. Add practical work or a visual only when you have a real source and a supported producer. Follow the installed `docs/training-content.md` reference for exercise/check/visual descriptors, exact relative paths and declared auxiliary `assets`. Do not add fake readiness or capabilities to make a draft appear runnable.
8. Trial and review the lesson with a human learner, including mistakes, assistance, recovery and relevant desktop/mobile controls. Only then change its root entry to `published`. Keep the topic `preview` until every required lesson is reviewed and published. A `released` topic cannot contain required draft lessons.

Before generating a course lock, add the real source repository as root `repository.url` in the format `https://github.com/<owner>/learn-<topic>.git`, commit the intended topic and leave it clean. Use the installed publishing guide for `vibe64 training publish-manifest`; local lock generation does not create or publish a remote repository. A course chooses this whole topic, not a subset of its lessons.
