import { accounts, put, connection, secret } from "../store";

export class DeliveryError extends Error {
  constructor(message: string, public uncertain: boolean, public retryAfter = 0, public status?: number) { super(message); }
}
/** Never forward the provider key to signed-upload hosts, redirects, or error messages. */
export async function request(connectionId: string, endpoint: string, method = "GET", body?: unknown): Promise<unknown> {
  const c = connection(connectionId), key = secret(connectionId);
  if (!key) throw new DeliveryError("Set this connection's API key in Publishing settings.", false);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  let response: Response;
  try { response = await fetch(`${c.baseUrl.replace(/\/$/, "")}${endpoint}`, { method, headers, body: payload, redirect: "error", signal: AbortSignal.timeout(120_000) }); }
  catch { throw new DeliveryError(`${c.name}: no confirmed response. Check the provider before retrying a submission.`, method !== "GET"); }
  if (!response.ok) {
    if (response.status === 401) {
      put("connection", c.id, { ...c, configured: false, error: "API credentials were rejected. Reconnect this provider." });
      for (const account of accounts().filter(a => a.connectionId === c.id)) put("account", account.id, { ...account, needsReconnect: true });
    }
    const hint = response.status === 401 || response.status === 403 ? "Check API key, account connection and required scopes." : "Check the provider's post details and account requirements.";
    throw new DeliveryError(`${c.name}: HTTP ${response.status}. ${hint}`, response.status >= 500 || response.status === 408, response.status === 429 ? Math.max(1, Math.min(3600, Number(response.headers.get("retry-after")) || (Date.parse(response.headers.get("retry-after") ?? "") - Date.now()) / 1000 || 30)) : 0, response.status);
  }
  if (response.status === 204) return null;
  try { return await response.json(); } catch { if (method === "DELETE") return null; throw new DeliveryError(`${c.name} returned an unreadable response.`, method !== "GET"); }
}
