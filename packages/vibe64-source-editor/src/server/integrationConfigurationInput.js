import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { integrationsSchema } from "@jskit-ai/connectors-core/shared/configuration";

// A changes request supplies only fields the person chose to change. Reuse the
// framework's types and reference constraints without create-time defaults.
function changeFields(schema) {
  return Object.fromEntries(Object.entries(schema.getFieldDefinitions()).map(([key, definition]) => {
    const { defaultTo: _default, ...field } = definition;
    return [key, { ...field, required: false, nullable: true }];
  }));
}

const fields = integrationsSchema.getFieldDefinitions();
const integration = changeFields(fields.integrations.values);
delete integration.extensions;
for (const key of ["authentication", "assistantPolicy"]) {
  integration[key] = { ...integration[key], schema: createSchema(changeFields(integration[key].schema)) };
}
// Removing one policy choice must not replace the other action permissions.
integration.assistantPolicy.schema = createSchema({
  ...integration.assistantPolicy.schema.getFieldDefinitions(),
  actions: { ...integration.assistantPolicy.schema.getFieldDefinition("actions"),
    values: { ...integration.assistantPolicy.schema.getFieldDefinition("actions").values, nullable: true } }
});

const integrationConfigurationChangesSchema = createSchema({
  integrations: { type: "object", values: { type: "object", nullable: true, schema: createSchema(integration) }, required: false },
  registrations: { type: "object", values: { type: "object", nullable: true,
    schema: createSchema(changeFields(fields.registrations.values)) }, required: false }
});

export { integrationConfigurationChangesSchema };
