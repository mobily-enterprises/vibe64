import {
  actionInputFieldIsPrivate,
  publicActionInputValuesForFields
} from "@/lib/vibe64ActionInputModel.js";
import {
  appendPromptAttachmentFileNames,
  appendPromptAttachmentReferences
} from "@/lib/vibe64PromptAttachments.js";

function plainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function controlHasInputFields(control = {}) {
  return Array.isArray(control?.inputFields) && control.inputFields.length > 0;
}

function initialControlValues(control = {}) {
  return Object.fromEntries((Array.isArray(control.inputFields) ? control.inputFields : [])
    .map((field) => [field.name, String(field.value ?? "")]));
}

function selectedControlDraftText({
  fields = [],
  values = {}
} = {}) {
  const inputFields = Array.isArray(fields) ? fields : [];
  const publicValues = publicActionInputValuesForFields(inputFields, plainObject(values));
  if (Object.hasOwn(publicValues, "conversationRequest")) {
    return String(publicValues.conversationRequest || "").trim();
  }
  const publicFields = inputFields.filter((field) => !actionInputFieldIsPrivate(field));
  return publicFields.length === 1
    ? String(publicValues[publicFields[0]?.name] || "").trim()
    : "";
}

function numberedQuestionInputValuesForLogicalField(value = "", questions = []) {
  const source = String(value || "");
  return Object.fromEntries((Array.isArray(questions) ? questions : [])
    .map((question) => {
      const pattern = new RegExp(`^\\[${question.number}\\]\\s+(.+)$`, "imu");
      return [
        question.name,
        String(source.match(pattern)?.[1] || "").trim()
      ];
    }));
}

function selectedControlValuesMatchFields(values = {}, fields = []) {
  const sourceValues = plainObject(values);
  const fieldNames = new Set((Array.isArray(fields) ? fields : [])
    .map((field) => String(field?.name || ""))
    .filter(Boolean));
  return Object.keys(sourceValues).every((name) => fieldNames.has(name)) &&
    [...fieldNames].every((name) => Object.hasOwn(sourceValues, name));
}

function selectedControlValuesForFields(control = {}, fields = [], values = {}) {
  const sourceValues = plainObject(values);
  const initialValues = initialControlValues(control);
  return Object.fromEntries((Array.isArray(fields) ? fields : [])
    .map((field) => {
      const name = String(field?.name || "");
      return [name, String(sourceValues[name] ?? initialValues[name] ?? "")];
    })
    .filter(([name]) => Boolean(name)));
}

function attachmentFieldsFromOptions(options = {}) {
  return plainObject(options?.attachmentFields);
}

function fieldsWithAttachments(fields = {}, attachmentFields = {}, append) {
  const nextFields = {
    ...plainObject(fields)
  };
  for (const [fieldName, attachments] of Object.entries(attachmentFields)) {
    if (Array.isArray(attachments) && attachments.length > 0) {
      nextFields[fieldName] = append(nextFields[fieldName], attachments);
    }
  }
  return nextFields;
}

function withAttachmentReferences(fields = {}, attachmentFields = {}) {
  return fieldsWithAttachments(fields, attachmentFields, appendPromptAttachmentReferences);
}

function withAttachmentDisplayNames(fields = {}, attachmentFields = {}) {
  return fieldsWithAttachments(fields, attachmentFields, appendPromptAttachmentFileNames);
}

export {
  attachmentFieldsFromOptions,
  controlHasInputFields,
  initialControlValues,
  numberedQuestionInputValuesForLogicalField,
  plainObject,
  selectedControlDraftText,
  selectedControlValuesForFields,
  selectedControlValuesMatchFields,
  withAttachmentDisplayNames,
  withAttachmentReferences
};
