const MEDBLOCKS_API_BASE_URL = process.env.MEDBLOCKS_API_BASE_URL ?? "https://app.medblocks.com";

export interface MedblocksLaunchContext {
  id: string;
  resource_type: string;
  status: string;
  patient?: string | null;
  encounter?: string | null;
  fhir_user?: string | null;
  fhir_source?: string | null;
  fhir_base_url?: string | null;
  created_at?: string;
}

export async function resolveMedblocksLaunchContext(handle: string): Promise<MedblocksLaunchContext> {
  const apiKey = process.env.MEDBLOCKS_API_KEY;
  if (!apiKey) throw new Error("MEDBLOCKS_API_KEY is not configured.");
  const response = await fetch(`${MEDBLOCKS_API_BASE_URL}/launch-contexts/${encodeURIComponent(handle)}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  if (!response.ok) throw new Error(`Medblocks launch context request failed (${response.status}).`);
  const context = await response.json() as MedblocksLaunchContext;
  if (!context || typeof context !== "object" || context.resource_type !== "launch_context" || context.status !== "active") throw new Error("Medblocks returned an invalid or inactive launch context.");
  if (typeof context.patient !== "string" || !context.patient.trim()) throw new Error("Medblocks launch context did not include a patient.");
  return context;
}

export function resourceId(reference: string | null | undefined, resourceType: string): string | undefined {
  if (!reference) return undefined;
  const prefix = `${resourceType}/`;
  return reference.startsWith(prefix) ? reference.slice(prefix.length) : reference;
}
