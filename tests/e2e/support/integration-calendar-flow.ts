// The integrations.json that the Google Calendar flow in integrations.spec.ts
// leaves: added, saved as "Team calendar", edited by the CLI beside an unsaved
// draft, discarded and saved as "After CLI update". The tests that run the flow
// pin it byte for byte; every other provider test starts from it.
export const INTEGRATIONS_AFTER_CALENDAR_FLOW = `{
  "schemaVersion": 1,
  "integrations": {
    "google-calendar": {
      "provider": "google-calendar",
      "displayName": "After CLI update",
      "accountMode": "shared",
      "scopes": [
        "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
        "https://www.googleapis.com/auth/calendar.events.readonly"
      ],
      "authentication": {
        "method": "oauth2",
        "registrationRef": "google-calendar"
      }
    }
  },
  "registrations": {
    "google-calendar": {
      "source": "own",
      "clientId": "fixture.apps.googleusercontent.com",
      "clientSecretRef": "env:GOOGLE_CALENDAR_CLIENT_SECRET",
      "callbackUrlRef": "env:GOOGLE_CALENDAR_CALLBACK_URL"
    }
  },
  "extensions": {
    "application": {
      "keep": true
    }
  }
}
`;
