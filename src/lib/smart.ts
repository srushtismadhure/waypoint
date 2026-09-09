import { createHash, randomBytes } from "node:crypto";

export type SmartVendor = "epic" | "oracle" | "generic";

export interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  scopes_supported?: string[];
  capabilities?: string[];
  code_challenge_methods_supported?: string[];
}

export interface SmartTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  patient?: string;
  encounter?: string;
  scope?: string;
  id_token?: string;
  fhirUser?: string;
}

interface PendingSmartLaunch {
  state: string;
  nonce: string;
  issuer: string;
  launch: string;
  vendor: SmartVendor;
  clientId: string;
  redirectUri: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  codeVerifier: string;
  createdAt: number;
}

export interface SmartSession {
  id: string;
  issuer: string;
  accessToken: string;
  tokenType: string;
  patientId?: string;
  encounterId?: string;
  scope?: string;
  fhirUser?: string;
  createdAt: number;
  expiresAt: number;
}

const SMART_SESSION_COOKIE = "waypoint_smart_session";
const PENDING_LAUNCH_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Good enough for the current single-instance Render deployment. If Waypoint
// moves to multiple instances/serverless, move these maps to a shared store.
const pendingLaunches = new Map<string, PendingSmartLaunch>();
const smartSessions = new Map<string, SmartSession>();

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = Number(match[3]);
  const d = Number(match[4]);
  if ([a, b, c, d].some(value => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (isPrivateIpv4(host)) return true;
  return host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
}

/** Validate an EHR-provided issuer before the server fetches it (SSRF boundary). */
export function normalizeSmartIssuer(rawIssuer: string): string {
  const issuer = new URL(rawIssuer);
  const localDevelopment = process.env.NODE_ENV !== "production" && isPrivateHost(issuer.hostname);

  if (issuer.protocol !== "https:" && !(localDevelopment && issuer.protocol === "http:")) {
    throw new Error("SMART issuer must use HTTPS.");
  }
  if (issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error("SMART issuer must be a clean FHIR base URL.");
  }
  if (process.env.NODE_ENV === "production" && isPrivateHost(issuer.hostname)) {
    throw new Error("Private or local SMART issuers are not allowed in production.");
  }

  issuer.pathname = issuer.pathname.replace(/\/+$/, "");
  const normalized = issuer.toString().replace(/\/$/, "");
  const allowlist = (process.env.SMART_ALLOWED_ISSUERS ?? "")
    .split(",")
    .map(value => value.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  if (allowlist.length > 0 && !allowlist.includes(normalized)) {
    throw new Error("SMART issuer is not in SMART_ALLOWED_ISSUERS.");
  }
  return normalized;
}

function validateEndpoint(raw: string, label: string): string {
  const endpoint = new URL(raw);
  const localDevelopment = process.env.NODE_ENV !== "production" && isPrivateHost(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(localDevelopment && endpoint.protocol === "http:")) {
    throw new Error(`${label} must use HTTPS.`);
  }
  return endpoint.toString();
}

export async function discoverSmartConfiguration(issuer: string): Promise<SmartConfiguration> {
  const response = await fetch(`${issuer}/.well-known/smart-configuration`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`SMART discovery failed with status ${response.status}.`);

  const body = (await response.json().catch(() => null)) as Partial<SmartConfiguration> | null;
  if (!body || typeof body.authorization_endpoint !== "string" || typeof body.token_endpoint !== "string") {
    throw new Error("SMART discovery is missing authorization_endpoint or token_endpoint.");
  }

  return {
    ...body,
    authorization_endpoint: validateEndpoint(body.authorization_endpoint, "SMART authorization endpoint"),
    token_endpoint: validateEndpoint(body.token_endpoint, "SMART token endpoint"),
  } as SmartConfiguration;
}

export function inferSmartVendor(issuer: string, requestedVendor?: string | null): SmartVendor {
  const requested = requestedVendor?.trim().toLowerCase();
  if (requested === "epic") return "epic";
  if (requested === "oracle" || requested === "cerner") return "oracle";
  const hostname = new URL(issuer).hostname.toLowerCase();
  if (hostname.includes("epic")) return "epic";
  if (hostname.includes("cerner") || hostname.includes("oracle")) return "oracle";
  return "generic";
}

export function getSmartClientId(_issuer: string, vendor: SmartVendor): string {
  const clientId = vendor === "epic"
    ? process.env.EPIC_CLIENT_ID ?? process.env.SMART_CLIENT_ID
    : vendor === "oracle"
      ? process.env.ORACLE_CLIENT_ID ?? process.env.SMART_CLIENT_ID
      : process.env.SMART_CLIENT_ID;
  if (!clientId?.trim()) throw new Error("Missing SMART client ID for this EHR.");
  return clientId.trim();
}

export function getSmartScopes(): string {
  return (process.env.SMART_SCOPES ?? [
    "launch",
    "openid",
    "fhirUser",
    "patient/Patient.r",
    "patient/Condition.rs",
    "patient/Observation.rs",
    "patient/Encounter.rs",
    "patient/MedicationRequest.rs",
    "patient/ServiceRequest.rs",
  ].join(" ")).trim();
}

export function getSmartRedirectUri(request: Request): string {
  const base = new URL(process.env.APP_BASE_URL?.trim() || new URL(request.url).origin);
  if (process.env.NODE_ENV === "production" && base.protocol !== "https:") {
    throw new Error("APP_BASE_URL must use HTTPS in production.");
  }
  base.pathname = base.pathname.replace(/\/+$/, "");
  base.search = "";
  base.hash = "";
  return `${base.toString().replace(/\/$/, "")}/smart/callback`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBase64Url(64);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function createPendingSmartLaunch(input: Omit<PendingSmartLaunch, "state" | "nonce" | "createdAt">): PendingSmartLaunch {
  cleanupExpiredState();
  const pending: PendingSmartLaunch = { ...input, state: randomBase64Url(), nonce: randomBase64Url(), createdAt: Date.now() };
  pendingLaunches.set(pending.state, pending);
  return pending;
}

export function consumePendingSmartLaunch(state: string): PendingSmartLaunch | null {
  cleanupExpiredState();
  const pending = pendingLaunches.get(state) ?? null;
  if (pending) pendingLaunches.delete(state);
  return pending;
}

function cleanupExpiredState(): void {
  const now = Date.now();
  for (const [state, pending] of pendingLaunches) {
    if (now - pending.createdAt > PENDING_LAUNCH_TTL_MS) pendingLaunches.delete(state);
  }
  for (const [id, session] of smartSessions) {
    if (now >= session.expiresAt) smartSessions.delete(id);
  }
}

export function createSmartSession(issuer: string, token: SmartTokenResponse): SmartSession {
  cleanupExpiredState();
  const now = Date.now();
  const seconds = typeof token.expires_in === "number" && token.expires_in > 0
    ? token.expires_in
    : DEFAULT_TOKEN_TTL_MS / 1000;
  const session: SmartSession = {
    id: randomBase64Url(),
    issuer,
    accessToken: token.access_token,
    tokenType: token.token_type?.trim() || "Bearer",
    patientId: token.patient || undefined,
    encounterId: token.encounter || undefined,
    scope: token.scope || undefined,
    fhirUser: token.fhirUser || undefined,
    createdAt: now,
    expiresAt: now + Math.min(seconds * 1000, MAX_TOKEN_TTL_MS),
  };
  smartSessions.set(session.id, session);
  return session;
}

export function getSmartSession(sessionId: string | undefined | null): SmartSession | null {
  cleanupExpiredState();
  return sessionId ? smartSessions.get(sessionId) ?? null : null;
}

export function deleteSmartSession(sessionId: string | undefined | null): void {
  if (sessionId) smartSessions.delete(sessionId);
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get("cookie");
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name) cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function getSmartSessionFromRequest(request: Request): SmartSession | null {
  return getSmartSession(parseCookies(request)[SMART_SESSION_COOKIE]);
}

export function buildSmartSessionCookie(session: SmartSession): string {
  const parts = [
    `${SMART_SESSION_COOKIE}=${encodeURIComponent(session.id)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function buildClearedSmartSessionCookie(): string {
  const parts = [`${SMART_SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}
