// The capture engine's rules hold the same whichever way a process starts its commands. Their own files run in a
// process that runs its commands itself, as the session work child and the CLIs do; here the same tests run in a
// process that sends its commands to a spawner, as the editor server does from its boot.
import { startCommandSpawner } from "../../packages/vibe64-execution/src/server/engines/commandSpawner.js";

startCommandSpawner();
await import("./vibe64CaptureCommand.unit.test.js");
await import("./vibe64CaptureDrainOutcome.unit.test.js");
