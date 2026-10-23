// The pinned Android shell Vibe64 generates for a `capacitor` package. Every
// version that decides the bytes of the APK lives here, so a template change is
// one reviewed edit and shows up in the plan's template record.
//
// Capacitor 8.5.3's own Android template supplies AGP 8.13.0 and Gradle 8.14.3;
// Vibe64 pins the SDK levels, the Gradle distribution checksum and the
// build-tools AGP expects, and patches the generated project (shellPatch.js).
const CAPACITOR_SHELL_TEMPLATE = Object.freeze({
  id: "vibe64.capacitor-android.v1",
  capacitor: "8.5.3",
  compileSdk: 36,
  targetSdk: 36,
  minSdk: 24,
  buildTools: "35.0.0",
  platform: "android-36",
  java: 21,
  gradle: Object.freeze({
    version: "8.14.3",
    distributionUrl: "https\\://services.gradle.org/distributions/gradle-8.14.3-all.zip",
    distributionSha256Sum: "ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c"
  }),
  // AndroidX levels Capacitor 8.5.3 was released against (its variables.gradle).
  androidx: Object.freeze({
    androidxActivityVersion: "1.11.0",
    androidxAppCompatVersion: "1.7.1",
    androidxCoordinatorLayoutVersion: "1.3.0",
    androidxCoreVersion: "1.17.0",
    androidxFragmentVersion: "1.8.9",
    coreSplashScreenVersion: "1.2.0",
    androidxWebkitVersion: "1.14.0",
    junitVersion: "4.13.2",
    androidxJunitVersion: "1.3.0",
    androidxEspressoCoreVersion: "3.7.0",
    cordovaAndroidVersion: "14.0.1"
  })
});

// The shell's own npm packages, always at the pinned Capacitor version.
const SHELL_RUNTIME_PACKAGES = Object.freeze(["@capacitor/android", "@capacitor/core"]);
const SHELL_TOOL_PACKAGES = Object.freeze(["@capacitor/cli"]);

function shellTemplateRecord() {
  return {
    "capacitor-android-shell": CAPACITOR_SHELL_TEMPLATE.id,
    capacitor: CAPACITOR_SHELL_TEMPLATE.capacitor,
    "android-target-sdk": String(CAPACITOR_SHELL_TEMPLATE.targetSdk),
    "android-build-tools": CAPACITOR_SHELL_TEMPLATE.buildTools,
    gradle: CAPACITOR_SHELL_TEMPLATE.gradle.version
  };
}

export { CAPACITOR_SHELL_TEMPLATE, SHELL_RUNTIME_PACKAGES, SHELL_TOOL_PACKAGES, shellTemplateRecord };
