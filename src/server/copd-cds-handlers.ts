import { timingSafeEqual } from "node:crypto";
import { requireStaff, requireRole } from "../lib/auth";
import { getFhirConfig } from "../lib/fhir-config";
import { copdCards, copdMedicationKey, patientIdValid } from "../lib/copd-cds";
import { evaluateCopdPatient } from "../lib/copd-cds-service";
import { evaluateMedicationSafety } from "../lib/cds-hooks";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function authorized(req: Request, patientId: string): boolean {
  const staff = requireStaff(req);
  if (staff) return staff.mode !== "ehr" || staff.patientId === patientId;
  const expected = process.env.CDS_CLIENT_TOKEN;
  const provided = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (expected && provided && Buffer.byteLength(expected) === Buffer.byteLength(provided)) return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  return process.env.CDS_ALLOW_ANONYMOUS_DEMO === "true" && process.env.NODE_ENV !== "production";
}
export async function handleCopdHook(req: Request, hook: "patient-view" | "order-select" | "order-sign"): Promise<Response> {
  let body: { hook?: string; hookInstance?: string; fhirServer?: string; prefetch?: unknown; context?: { patientId?: string; userId?: string; encounterId?: string; draftOrders?: fhir4.Bundle; selections?: string[] } };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body." }, 400); }
  if (!body || body.hook !== hook || typeof body.hookInstance !== "string" || !body.hookInstance.trim() || !patientIdValid(body.context?.patientId) || typeof body.context?.userId !== "string" || !body.context.userId.trim()) return json({ error: "Matching hook, hookInstance, context.patientId, and context.userId are required." }, 400);
  const patientId = body.context.patientId;
  if (!authorized(req, patientId)) return json({ error: "An authorized CDS client or matching staff session is required." }, 401);
  try {
    if (body.fhirServer !== undefined && (typeof body.fhirServer !== "string" || body.fhirServer.replace(/\/$/, "") !== getFhirConfig().baseUrl.replace(/\/$/, ""))) return json({ error: "This CDS service is bound to its configured Medblocks FHIR store." }, 400);
    const publicUrl = process.env.WAYPOINT_PUBLIC_URL ?? (process.env.NODE_ENV !== "production" ? new URL(req.url).origin : undefined);
    if (!publicUrl) return json({ error: "WAYPOINT_PUBLIC_URL is required for CDS links." }, 503);
    if (hook !== "patient-view") {
      const bundle = body.context.draftOrders;
      if (bundle?.resourceType !== "Bundle" || !Array.isArray(bundle.entry)) return json({ error: "context.draftOrders must be a FHIR Bundle." }, 400);
      let drafts = bundle.entry.map(entry => entry.resource).filter((resource): resource is fhir4.MedicationRequest => resource?.resourceType === "MedicationRequest");
      if (drafts.some(draft => draft.subject?.reference !== `Patient/${patientId}` && draft.subject?.reference !== `${getFhirConfig().baseUrl.replace(/\/$/, "")}/Patient/${patientId}`)) return json({ error: "Draft orders must belong to context.patientId." }, 400);
      if (hook === "order-select") {
        const selections = body.context.selections;
        if (!Array.isArray(selections) || selections.some(value => typeof value !== "string")) return json({ error: "context.selections is required for order-select." }, 400);
        drafts = drafts.filter(draft => selections.includes(`MedicationRequest/${draft.id}`));
      }
      // Interaction/dose checking stays disabled until an institution-validated source is configured; this always returns no cards today.
      const safety = await evaluateMedicationSafety(patientId, drafts, { profile: "copd" });
      if (!drafts.length) return json({ cards: safety.cards });
      // The one deterministic COPD rule that is meaningful at order time: an unresolved reconciliation discrepancy for a medication being ordered.
      const draftKeys = new Set(drafts.map(copdMedicationKey).filter((key): key is string => !!key));
      const result = await evaluateCopdPatient(patientId, false, body.prefetch);
      const scoped = result.findings.filter(finding => finding.category === "MEDICATION_RECONCILIATION" && (hook === "order-sign" || finding.medicationKeys?.some(key => draftKeys.has(key))));
      return json({ cards: [...safety.cards, ...copdCards({ ...result, findings: scoped }, publicUrl, process.env.CDS_SMART_LAUNCH_URL)] });
    }
    // Prefetch is only usable because fhirServer is pinned to the configured store above; the engine re-filters every resource to context.patientId.
    const result = await evaluateCopdPatient(patientId, false, body.prefetch);
    return json({ cards: copdCards(result, publicUrl, process.env.CDS_SMART_LAUNCH_URL) });
  } catch { return json({ error: "COPD decision support is temporarily unavailable." }, 502); }
}

export async function handleCopdPatientSupport(req: Request, patientId: string): Promise<Response> {
  const staff = requireRole(req, "nurse", "clinician");
  if (!staff || staff.mode === "ehr" && staff.patientId !== patientId) return json({ error: "A matching staff session is required." }, 403);
  if (!patientIdValid(patientId)) return json({ error: "Invalid patient ID." }, 400);
  if (staff.mode === "ehr" && staff.fhirBaseUrl && staff.fhirBaseUrl.replace(/\/$/, "") !== getFhirConfig().baseUrl.replace(/\/$/, "")) return json({ error: "EHR context belongs to a different FHIR store." }, 409);
  try { return json(await evaluateCopdPatient(patientId, req.method === "POST")); }
  catch { return json({ error: "Unable to evaluate or persist COPD decision support. Retry after checking FHIR availability." }, 502); }
}
