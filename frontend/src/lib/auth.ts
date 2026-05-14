const TOKEN_KEY = "qj_auth_token";

export type AuthSession = {
  authenticated: boolean;
  username: string;
};

export function authToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const token = authToken();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearAuthToken();
    window.dispatchEvent(new Event("qj-auth-expired"));
  }
  return response;
}

export async function login(username: string, password: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Login failed");
  setAuthToken(data.token);
  return data as { token: string; username: string; expiresAt: number };
}

export async function logout() {
  await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  clearAuthToken();
}

export async function fetchSession() {
  const response = await authFetch("/api/auth/session");
  if (!response.ok) return null;
  return response.json() as Promise<AuthSession>;
}

export function authenticatedStreamUrl(path: string) {
  const token = authToken();
  if (!token) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}authToken=${encodeURIComponent(token)}`;
}
