import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import { config } from "../../config/public.js";

const surfaceRuntime = createSurfaceRuntime({
  allMode: config.surfaceModeAll,
  surfaces: config.surfaceDefinitions,
  defaultSurfaceId: config.surfaceDefaultId
});

export { surfaceRuntime };
