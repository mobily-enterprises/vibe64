import { expect, test } from "@playwright/test";
import { runAdaptiveShellSmoke } from "@jskit-ai/shell-web/test/adaptiveShellSmoke";

runAdaptiveShellSmoke({ test, expect, smokePath: "/app" });
