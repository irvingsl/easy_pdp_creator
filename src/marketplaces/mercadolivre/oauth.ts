const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const API = "https://api.mercadolibre.com";

export const APP_URL = process.env.APP_URL ?? "https://easy-pdp-creator.vercel.app";
/** Precisa ser idêntica à Redirect URI cadastrada no DevCenter. */
export const REDIRECT_URI = `${APP_URL}/api/mercadolivre/callback`;

export type MlTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: number;
};

function creds() {
  const id = process.env.ML_CLIENT_ID;
  const secret = process.env.ML_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Defina ML_CLIENT_ID e ML_CLIENT_SECRET");
  return { id, secret };
}

export function authorizeUrl(state: string) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", creds().id);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<MlTokens> {
  const { id, secret } = creds();
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ML oauth ${res.status}: ${JSON.stringify(body)}`);
  return body as MlTokens;
}

export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });

export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function mlGet(path: string, accessToken: string) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}

export async function mlPost(path: string, accessToken: string, payload: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = text || null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* mantém o texto */
  }
  return { status: res.status, ok: res.ok, body };
}
