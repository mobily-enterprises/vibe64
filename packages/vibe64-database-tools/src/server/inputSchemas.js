import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

function validator(fields) {
  return deepFreeze({
    mode: "patch",
    schema: createSchema(fields)
  });
}

const optionalText = {
  noTrim: false,
  required: false,
  type: "string"
};

const requiredText = {
  ...optionalText,
  required: true
};

const optionalUser = {
  additionalProperties: true,
  required: false,
  type: "object"
};

const openObject = {
  additionalProperties: true,
  required: true,
  type: "object"
};

const sessionFields = {
  sessionId: requiredText,
  vibe64User: optionalUser
};

const databaseStateInputValidator = validator(sessionFields);

const databaseRefreshInputValidator = validator({
  ...sessionFields,
  source: optionalText
});

const databaseQueryInputValidator = validator({
  ...sessionFields,
  automatic: {
    required: false,
    type: "boolean"
  },
  confirmationDatabase: optionalText,
  confirmed: {
    required: false,
    type: "boolean"
  },
  queryId: requiredText,
  readOnly: {
    required: true,
    type: "boolean"
  },
  sql: requiredText,
  writeUnlocked: {
    required: false,
    type: "boolean"
  }
});

const databaseCancelInputValidator = validator({
  ...sessionFields,
  queryId: requiredText
});

const databaseCellUpdateInputValidator = validator({
  ...sessionFields,
  edit: openObject,
  value: {
    nullable: true,
    required: true,
    type: "none"
  }
});

const databaseRowInsertInputValidator = validator({
  ...sessionFields,
  table: openObject,
  values: openObject
});

const databaseRowDeleteInputValidator = validator({
  ...sessionFields,
  confirmed: {
    required: true,
    type: "boolean"
  },
  key: openObject,
  table: openObject
});

const databaseLookupInputValidator = validator({
  ...sessionFields,
  displayColumn: optionalText,
  relationshipId: requiredText,
  search: optionalText
});

const databaseLayoutInputValidator = validator({
  ...sessionFields,
  layout: openObject
});

const databaseOverviewInputValidator = validator({
  ...sessionFields,
  baseHash: optionalText,
  definition: openObject
});

const databaseSnippetSaveInputValidator = validator({
  ...sessionFields,
  snippet: openObject
});

const databaseSnippetDeleteInputValidator = validator({
  ...sessionFields,
  snippetId: requiredText
});

const databaseAssistantInputValidator = validator({
  ...sessionFields,
  messages: {
    items: {
      additionalProperties: true,
      type: "object"
    },
    required: true,
    type: "array"
  }
});

export {
  databaseOverviewInputValidator,
  databaseAssistantInputValidator,
  databaseCancelInputValidator,
  databaseCellUpdateInputValidator,
  databaseLayoutInputValidator,
  databaseLookupInputValidator,
  databaseQueryInputValidator,
  databaseRefreshInputValidator,
  databaseRowDeleteInputValidator,
  databaseRowInsertInputValidator,
  databaseSnippetDeleteInputValidator,
  databaseSnippetSaveInputValidator,
  databaseStateInputValidator
};
