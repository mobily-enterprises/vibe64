// The one error shape AI connection operations throw: a stable code, the HTTP
// status the route answers with and, for form errors, per-field messages.
function aiConnectionError(code, message, statusCode = 400, fieldErrors = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (fieldErrors) {
    error.fieldErrors = fieldErrors;
  }
  return error;
}

export { aiConnectionError };
