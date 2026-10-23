// Host toolchains for app builds, installed only into folders the caller names.
export {
  ANDROID_LICENCE_ID,
  ANDROID_TERMS_URL,
  SDK_PACKAGES,
  androidSdkLicence,
  describeAndroidSdk,
  findAndroidSdk,
  installAndroidSdk
} from "./androidSdk.js";
export { REQUIRED_JAVA, TEMURIN_LICENCE, describeJdk, findJdk, hostPlatform, installJdk } from "./jdk.js";
