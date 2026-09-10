export type DemoRole = "nurse" | "clinician" | "patient";

export interface DemoUser {
  mode?: "demo" | "ehr";
  email: string;
  displayName: string;
  role: DemoRole;
  patientId?: string;
  encounterId?: string;
  fhirUser?: string;
  fhirSource?: string;
  fhirBaseUrl?: string;
}

export interface SessionState {
  authenticated: boolean;
  user?: DemoUser;
  expiresAt?: number;
}

export async function getSession(): Promise<SessionState> {
  try {
    const response = await fetch("/api/session", { credentials: "include" });
    if (!response.ok) return { authenticated: false };
    return (await response.json()) as SessionState;
  } catch {
    // Network failure or a non-JSON error response (e.g. a crashed serverless
    // function) — fail safe to unauthenticated rather than throwing, so the
    // caller never gets stuck waiting on a promise that never resolves.
    return { authenticated: false };
  }
}

export interface DemoLoginResult {
  ok: boolean;
  user?: DemoUser;
}

export async function startDemoSession(role: DemoRole): Promise<DemoLoginResult> {
  const response = await fetch("/api/demo-login", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) return { ok: false };
  const body = (await response.json()) as SessionState;
  return { ok: true, user: body.user };
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", { method: "POST", credentials: "include" });
}

export async function extendSession(): Promise<SessionState> {
  const response = await fetch("/api/session/extend", { method: "POST", credentials: "include" });
  if (!response.ok) return { authenticated: false };
  return (await response.json()) as SessionState;
}
