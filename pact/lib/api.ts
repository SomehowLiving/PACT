/**
 * Browser helper for PACT's write routes. Writes need a wallet session; when the server answers
 * that the browser is not signed in (or signed in as another wallet), the registered signer asks
 * the connected wallet for one gasless sign-in signature and the write is retried once.
 */

type Signer = () => Promise<boolean>;

let signer: Signer | null = null;
let inFlight: Promise<boolean> | null = null;

/** DeskProvider registers how to sign in with the connected wallet. */
export function registerSignIn(fn: Signer | null) {
  signer = fn;
}

/** Sign in once, sharing one wallet prompt between concurrent writes. */
export function signIn(): Promise<boolean> {
  if (!signer) return Promise.resolve(false);
  inFlight ??= signer().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function needsSession(res: Response) {
  if (res.status !== 401 && res.status !== 403) return false;
  const body = (await res.clone().json().catch(() => ({}))) as { code?: string };
  return body.code === "SIGN_IN_REQUIRED" || body.code === "SESSION_MISMATCH";
}

export async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const send = () => fetch(url, { credentials: "same-origin", ...init });
  const res = await send();
  if (!(await needsSession(res))) return res;
  if (!(await signIn())) return res;
  return send();
}

export function apiPost(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return apiFetch(url, {
    method: "POST",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    body: JSON.stringify(body),
  });
}

/** The sign-in exchange itself, given a way to sign a message with the connected wallet. */
export async function signInWith(address: string, signMessage: (message: string) => Promise<string>) {
  const nonce = await fetch("/api/session/nonce", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  if (!nonce.ok) return false;
  const { message } = (await nonce.json()) as { message: string };
  let signature: string;
  try {
    signature = await signMessage(message);
  } catch {
    return false; // the wallet declined
  }
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  return res.ok;
}
