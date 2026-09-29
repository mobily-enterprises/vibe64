import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { INTEGRATION_SETUP_OPERATIONS } from "./integrationSetupCommand.js";

const text = { type: "string", noTrim: true, required: false };
const reviewId = { ...text, minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" };
const adsSelection = createSchema({
  customerId: { ...text, pattern: "^[0-9]{10}$" }, name: { ...text, minLength: 1, maxLength: 100 },
  campaignId: { ...text, pattern: "^[0-9]{1,20}$" }, reviewId,
  trackingConfirmed: { type: "boolean", strictBoolean: true, required: false },
  billingConfirmed: { type: "boolean", strictBoolean: true, required: false }
});

// The application command owns operation-specific validation. Both source
// contexts use these public inputs; a host may expose a subset of operations.
export const integrationSetupInputSchema = createSchema({
  integrationId: { ...text, minLength: 1, maxLength: 200, pattern: "^[a-z][a-z0-9-]*$", required: true },
  operation: { ...text, minLength: 1, enum: INTEGRATION_SETUP_OPERATIONS, required: true },
  attemptId: { ...text, pattern: "^[A-Za-z0-9_-]{1,256}$" },
  verificationInput: { type: "object", additionalProperties: true, required: false },
  ads: { type: "object", schema: adsSelection, required: false },
  paymentEnvironment: { ...text, enum: ["sandbox", "live"] }, reviewId,
  providerId: { ...text, pattern: "^[A-Za-z0-9_-]{1,200}$" },
  subjectId: { ...text, minLength: 1, maxLength: 200 },
  collection: { ...text, enum: ["subscriptions", "transactions"] },
  after: { ...text, nullable: true, pattern: "^[A-Za-z0-9_-]{1,200}$" }
});
