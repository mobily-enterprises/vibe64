// The native capabilities a `capacitor` package may declare with
// `- Permission <id>: <reason>`, and the Android permissions each one adds. The
// set is closed: an unknown id is a preflight Block, never a guess.
const ANDROID_PERMISSIONS = Object.freeze({
  camera: Object.freeze({ label: "Camera", android: Object.freeze(["android.permission.CAMERA"]) }),
  microphone: Object.freeze({ label: "Microphone", android: Object.freeze(["android.permission.RECORD_AUDIO"]) }),
  location: Object.freeze({
    label: "Location",
    android: Object.freeze(["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"])
  }),
  notifications: Object.freeze({ label: "Notifications", android: Object.freeze(["android.permission.POST_NOTIFICATIONS"]) }),
  photos: Object.freeze({
    label: "Photos and videos",
    android: Object.freeze(["android.permission.READ_MEDIA_IMAGES", "android.permission.READ_MEDIA_VIDEO"])
  }),
  contacts: Object.freeze({ label: "Contacts", android: Object.freeze(["android.permission.READ_CONTACTS"]) }),
  calendar: Object.freeze({
    label: "Calendar",
    android: Object.freeze(["android.permission.READ_CALENDAR", "android.permission.WRITE_CALENDAR"])
  }),
  bluetooth: Object.freeze({
    label: "Nearby Bluetooth devices",
    android: Object.freeze(["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_CONNECT"])
  }),
  vibration: Object.freeze({ label: "Vibration", android: Object.freeze(["android.permission.VIBRATE"]) })
});

const ANDROID_PERMISSION_IDS = Object.freeze(Object.keys(ANDROID_PERMISSIONS));

// Every Android permission the declared ids add, sorted and without duplicates.
// Unknown ids are skipped here; preflight reports them.
function androidPermissionNames(permissions = []) {
  const names = new Set(["android.permission.INTERNET"]);
  for (const { id } of permissions) {
    for (const name of ANDROID_PERMISSIONS[id]?.android || []) names.add(name);
  }
  return [...names].sort();
}

export { ANDROID_PERMISSIONS, ANDROID_PERMISSION_IDS, androidPermissionNames };
