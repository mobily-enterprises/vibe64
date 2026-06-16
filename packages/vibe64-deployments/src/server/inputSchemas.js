import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const deploymentStateReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const deploymentPublishInputValidator = deepFreeze({
  schema: createSchema({
    publicName: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

const releaseIdInputValidator = deepFreeze({
  schema: createSchema({
    releaseId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const publicNameInputValidator = deepFreeze({
  schema: createSchema({
    publicName: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const customDomainInputValidator = deepFreeze({
  schema: createSchema({
    hostname: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const deploymentHostInputValidator = deepFreeze({
  schema: createSchema({
    host: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const deploymentTlsAskInputValidator = deepFreeze({
  schema: createSchema({
    domain: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  customDomainInputValidator,
  deploymentHostInputValidator,
  deploymentPublishInputValidator,
  deploymentStateReadInputValidator,
  deploymentTlsAskInputValidator,
  publicNameInputValidator,
  releaseIdInputValidator
};
