import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/types";

const STORE_KEY = "__zane_auth_store__";
const STORAGE_KEY = "zane_auth_token";
const AUTH_BASE_URL = (import.meta.env.VITE_AUTH_URL ?? "").replace(/\/$/, "");

type AuthStatus = "loading" | "signed_out" | "signed_in" | "needs_setup";

interface AuthUser {
  id: string;
  name: string;
}

interface AuthSessionResponse {
  authenticated: boolean;
  user: AuthUser | null;
  hasPasskey: boolean;
}

interface AuthVerifyResponse {
  verified: boolean;
  token: string;
  user?: AuthUser;
}

interface LoginOptionsResponse extends PublicKeyCredentialRequestOptionsJSON {
  error?: string;
}

interface RegisterOptionsResponse extends PublicKeyCredentialCreationOptionsJSON {
  error?: string;
}

function apiUrl(path: string): string {
  return `${AUTH_BASE_URL}${path}`;
}

async function parseResponse<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

class AuthStore {
  status = $state<AuthStatus>("loading");
  hasPasskey = $state(false);
  token = $state<string | null>(null);
  user = $state<AuthUser | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);

  constructor() {
    this.#loadToken();
    void this.initialize();
  }

  async initialize() {
    this.status = "loading";
    this.error = null;

    try {
      const response = await fetch(apiUrl("/auth/session"), {
        method: "GET",
        headers: this.#authHeaders(),
      });
      const data = await parseResponse<AuthSessionResponse>(response);

      if (!response.ok || !data) {
        this.error = "Auth service unavailable.";
        this.status = "signed_out";
        return;
      }

      this.hasPasskey = data.hasPasskey;

      if (data.authenticated && data.user) {
        this.user = data.user;
        this.status = "signed_in";
      } else {
        this.token = null;
        this.#clearToken();
        this.status = this.hasPasskey ? "signed_out" : "needs_setup";
      }
    } catch {
      this.error = "Auth service unavailable.";
      this.status = "signed_out";
    }
  }

  async signIn(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;

    try {
      const optionsResponse = await fetch(apiUrl("/auth/login/options"), {
        method: "POST",
      });
      const options = await parseResponse<LoginOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !options || options.error) {
        this.error = options?.error ?? "Unable to request sign-in.";
        return;
      }

      const credential = await startAuthentication({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/auth/login/verify"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential }),
      });
      const verify = await parseResponse<AuthVerifyResponse & { error?: string }>(verifyResponse);
      if (!verifyResponse.ok || !verify?.token) {
        this.error = verify?.error ?? "Sign-in failed.";
        return;
      }

      this.#applySession(verify);
      this.hasPasskey = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Sign-in cancelled.";
    } finally {
      this.busy = false;
    }
  }

  async register(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;

    try {
      const optionsResponse = await fetch(apiUrl("/auth/register/options"), {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#authHeaders() },
      });
      const options = await parseResponse<RegisterOptionsResponse>(optionsResponse);
      if (!optionsResponse.ok || !options || options.error) {
        this.error = options?.error ?? "Unable to start registration.";
        return;
      }

      const credential = await startRegistration({ optionsJSON: options });
      const verifyResponse = await fetch(apiUrl("/auth/register/verify"), {
        method: "POST",
        headers: { "content-type": "application/json", ...this.#authHeaders() },
        body: JSON.stringify({ credential }),
      });
      const verify = await parseResponse<AuthVerifyResponse & { error?: string }>(verifyResponse);
      if (!verifyResponse.ok || !verify?.token) {
        this.error = verify?.error ?? "Registration failed.";
        return;
      }

      this.#applySession(verify);
      this.hasPasskey = true;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Registration cancelled.";
    } finally {
      this.busy = false;
    }
  }

  async signOut(): Promise<void> {
    try {
      if (this.token) {
        await fetch(apiUrl("/auth/logout"), {
          method: "POST",
          headers: this.#authHeaders(),
        });
      }
    } catch {
      // ignore
    }
    this.token = null;
    this.user = null;
    this.status = this.hasPasskey ? "signed_out" : "needs_setup";
    this.error = null;
    this.#clearToken();
  }

  #applySession(payload: AuthVerifyResponse): void {
    this.token = payload.token;
    this.user = payload.user ?? null;
    this.status = "signed_in";
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, payload.token);
    }
  }

  #authHeaders(): HeadersInit {
    if (!this.token) return {};
    return { authorization: `Bearer ${this.token}` };
  }

  #loadToken(): void {
    if (typeof localStorage === "undefined") return;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      this.token = stored;
    }
  }

  #clearToken(): void {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
  }
}

function getStore(): AuthStore {
  const global = globalThis as Record<string, unknown>;
  if (!global[STORE_KEY]) {
    global[STORE_KEY] = new AuthStore();
  }
  return global[STORE_KEY] as AuthStore;
}

export const auth = getStore();
