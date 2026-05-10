import { loadAppConfig } from "./loadAppConfig.js";

class MainServiceProvider {
  static id = "local.main";

  // Register only lightweight app-local composition bindings here.
  async register(app) {
    const appConfig = await loadAppConfig({
      moduleUrl: import.meta.url
    });
    app.instance("appConfig", appConfig);
  }

  // Keep packages/main as app glue only.
  // When backend behavior becomes substantial, scaffold a dedicated package:
  //   jskit generate feature-server-generator scaffold <feature-name>
  boot() {}
}

export { MainServiceProvider };
