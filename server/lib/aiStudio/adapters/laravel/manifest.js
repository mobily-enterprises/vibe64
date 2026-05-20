import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_APPLICATION_TYPE_WEB
} from "../../applicationTypes.js";
import {
  createLaravelTargetAdapter
} from "./index.js";

const LARAVEL_ADAPTER_MANIFEST = deepFreeze({
  applicationTypes: [
    {
      explanation: "Full-stack PHP web applications and API-backed products using Laravel conventions, Composer, Artisan, Eloquent, and Vite.",
      id: AI_STUDIO_APPLICATION_TYPE_WEB,
      priority: 70
    }
  ],
  bestFor: "Full-stack PHP products, admin systems, API backends, CRUD-heavy business apps, and Laravel teams that want conventional framework structure.",
  createAdapter: createLaravelTargetAdapter,
  description: "Laravel is a PHP web application framework with Composer, Artisan, Eloquent, Blade, Vite, and official starter kits. The adapter understands Laravel setup, PHP toolchains, database runtime choices, starter authentication/team options, Composer scripts, and Artisan launch commands.",
  enabled: true,
  id: "laravel",
  label: "Laravel",
  outcome: "Studio can seed or inspect a Laravel app, configure SQLite, PostgreSQL, MySQL, or MariaDB, select official starter kits, authentication/team options, and test framework, then drive Codex with Laravel-specific prompts.",
  projectUrl: "https://laravel.com",
  projectUrlLabel: "Open Laravel project",
  summary: "The mainstream PHP framework for full-stack web applications and API backends.",
  techStack: [
    "PHP",
    "Laravel",
    "Composer",
    "Artisan",
    "Eloquent",
    "Vite"
  ]
});

export {
  LARAVEL_ADAPTER_MANIFEST
};
