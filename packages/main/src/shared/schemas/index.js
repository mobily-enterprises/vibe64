/**
 * App-local shared transport validators/resources live here.
 * Dedicated feature packages should keep their own schemas with the feature.
 *
 * Example:
 * import { createSchema } from "json-rest-schema";
 *
 * export const helloQuerySchema = createSchema({
 *   name: { type: "string", minLength: 1, maxLength: 80 }
 * });
 *
 * export const helloResponseSchema = {
 *   type: "object",
 *   additionalProperties: false,
 *   required: ["ok", "message"],
 *   properties: {
 *     ok: { type: "boolean" },
 *     message: { type: "string", minLength: 1 }
 *   }
 * };
 */
export {};
