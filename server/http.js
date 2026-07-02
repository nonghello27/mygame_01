// Shared across server/services: an Error carrying the HTTP status the api/
// layer should respond with (api handlers pass e.status straight through).

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
