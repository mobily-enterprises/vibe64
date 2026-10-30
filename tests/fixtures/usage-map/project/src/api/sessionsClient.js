export async function fetchSessions() {
  const response = await fetch("/api/sessions");
  return response.json();
}

export async function postSession(title) {
  const response = await fetch("/api/sessions", { method: "POST", body: JSON.stringify({ title }) });
  return response.json();
}
