import { executeFhirTransaction, readFhirResource, searchFhirResource } from "./fhir-server-client";
import { getFhirConfig } from "./fhir-config";
import { referencesPatient } from "./formatters";
import { COPD_CDS_SYSTEM, COPD_FINDING_SYSTEM, COPD_RULE_VERSION, evaluateCopd, patientIdValid } from "./copd-cds";
import type { CopdConfig, CopdFinding, CopdInput, CopdResult } from "./copd-cds";

const RESOURCE_TYPES = ["Condition", "Encounter", "Observation", "MedicationRequest", "MedicationStatement", "QuestionnaireResponse", "DetectedIssue", "Task", "ServiceRequest", "CarePlan", "Appointment"] as const;
type CopdResourceType = (typeof RESOURCE_TYPES)[number];

/** Mirrors COPD_PATIENT_VIEW_PREFETCH in cds-hooks.ts. Keys absent here are ignored and the type is fetched server-side. */
const PREFETCH_KEYS: Record<string, CopdResourceType> = { conditions: "Condition", encounters: "Encounter", observations: "Observation", medicationRequests: "MedicationRequest", medicationStatements: "MedicationStatement", questionnaireResponses: "QuestionnaireResponse", detectedIssues: "DetectedIssue", tasks: "Task" };

/**
 * A prefetch bundle is only trusted when it is a whole searchset: a `next` link or a `total` larger than
 * the entries returned means the CDS client paged the result, and a partial page can never prove absence.
 */
export function normalizePrefetch(prefetch: unknown): { resources: fhir4.Resource[]; complete: Partial<Record<CopdResourceType, boolean>> } {
  const resources: fhir4.Resource[] = [];
  const complete: Partial<Record<CopdResourceType, boolean>> = {};
  if (!prefetch || typeof prefetch !== "object" || Array.isArray(prefetch)) return { resources, complete };
  for (const [key, type] of Object.entries(PREFETCH_KEYS)) {
    const value = (prefetch as Record<string, unknown>)[key] as fhir4.Bundle | undefined;
    if (!value || value.resourceType !== "Bundle" || value.type !== "searchset") continue;
    if (value.link?.some(link => link.relation === "next")) continue;
    const entries = (value.entry ?? []).map(entry => entry.resource).filter((resource): resource is fhir4.Resource => resource?.resourceType === type && !!resource.id);
    if (value.total !== undefined && value.total > (value.entry?.length ?? 0)) continue;
    resources.push(...entries);
    complete[type] = true;
  }
  return { resources, complete };
}

export function copdConfig(): Partial<CopdConfig> {
  function window(name: string, fallback: number) {
    if (process.env[name] === undefined) return fallback;
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error(`Invalid ${name}`);
    return value;
  }
  return { schedulingAuthoritative: process.env.COPD_SCHEDULING_AUTHORITATIVE === "true", rehabilitationAuthoritative: process.env.COPD_REHAB_AUTHORITATIVE === "true", oxygenAuthoritative: process.env.COPD_OXYGEN_AUTHORITATIVE === "true", rehabReviewEnabled: process.env.COPD_REHAB_REVIEW_ENABLED !== "false", homeHealthReviewEnabled: process.env.COPD_HOME_HEALTH_REVIEW_ENABLED !== "false", rescueUseReviewEnabled: process.env.COPD_RESCUE_USE_REVIEW_ENABLED !== "false", recentDays: window("COPD_RECENT_DAYS", 90), signalDays: window("COPD_SIGNAL_DAYS", 30), followupWindowDays: window("COPD_FOLLOWUP_DAYS", 30) };
}
// Follow only same-store, same-resource search links. Partial/failed searches never prove absence.
export async function loadCopdData(patientId: string, now = new Date().toISOString(), prefetch?: unknown): Promise<CopdInput> {
  if (!patientIdValid(patientId)) throw new Error("Invalid patient ID.");
  const base = new URL(`${getFhirConfig().baseUrl.replace(/\/$/, "")}/`);
  const prefetched = normalizePrefetch(prefetch);
  const resources: fhir4.Resource[] = [...prefetched.resources];
  const complete: Record<string, boolean> = { ...prefetched.complete };
  await Promise.all(RESOURCE_TYPES.filter(type => !complete[type]).map(async type => {
    let query = type === "Appointment" ? `actor=${encodeURIComponent(`Patient/${patientId}`)}&_count=200` : `patient=${encodeURIComponent(patientId)}&_count=200`;
    const seen = new Set<string>();
    let count = 0;
    complete[type] = false;
    try {
      for (let page = 0; page < 25; page++) {
        if (seen.has(query)) return;
        seen.add(query);
        const response = await searchFhirResource<fhir4.Bundle>(type, query);
        const bundle = response.body;
        if (response.status !== 200 || bundle?.resourceType !== "Bundle" || bundle.type !== "searchset") return;
        for (const entry of bundle.entry ?? []) if (entry.resource?.resourceType === type && entry.search?.mode !== "include") { resources.push(entry.resource); count++; }
        const next = bundle.link?.find(link => link.relation === "next")?.url;
        if (!next) { complete[type] = bundle.total === undefined || count >= bundle.total; return; }
        const url = new URL(next, base);
        // Medblocks may emit http pagination URLs for its https endpoint.
        if (url.hostname !== base.hostname || url.port !== base.port || url.pathname !== `${base.pathname}${type}`) return;
        query = url.search.slice(1);
      }
    } catch { complete[type] = false; }
  }));
  return { patientId, resources, complete, now, config: copdConfig() };
}

function uuid(hash: string) { return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`; }
export function findingTransaction(findings: CopdFinding[], now: string): fhir4.Bundle {
  const entry: fhir4.BundleEntry[] = [];
  for (const finding of findings.filter(finding => finding.persistent)) {
    const issueUrl = `urn:uuid:${uuid(finding.id)}`;
    const identifier = [{ system: COPD_FINDING_SYSTEM, value: finding.id }];
    const patient = { reference: `Patient/${finding.patientId}` };
    const issue: fhir4.DetectedIssue = { resourceType: "DetectedIssue", identifier, status: "preliminary", patient, severity: finding.severity === "critical" ? "high" : "moderate", code: { text: finding.title, coding: [{ system: COPD_CDS_SYSTEM, code: finding.ruleId }] }, detail: `${finding.explanation}\nrule:${finding.ruleId} version:${COPD_RULE_VERSION}`, implicated: finding.sourceResources.map(reference => ({ reference })), identifiedDateTime: now };
    const task: fhir4.Task = { resourceType: "Task", identifier, status: "requested", intent: "order", for: patient, focus: { reference: issueUrl }, code: { coding: [{ system: COPD_CDS_SYSTEM, code: finding.ruleId }] }, description: finding.title, priority: finding.severity === "critical" ? "urgent" : "routine", authoredOn: now, owner: { display: "Clinician review pool" }, note: [{ text: finding.explanation }] };
    for (const resource of [issue, task]) entry.push({ ...(resource.resourceType === "DetectedIssue" ? { fullUrl: issueUrl } : {}), resource, request: { method: "POST", url: resource.resourceType, ifNoneExist: `identifier=${encodeURIComponent(`${COPD_FINDING_SYSTEM}|${finding.id}`)}` } });
  }
  return { resourceType: "Bundle", type: "transaction", entry };
}
function transactionSucceeded(status: number, body: fhir4.Bundle | fhir4.OperationOutcome) {
  return status >= 200 && status < 300 && body?.resourceType === "Bundle" && body.type === "transaction-response" && !!body.entry?.length && body.entry.every(entry => /^2\d\d\b/.test(entry.response?.status ?? ""));
}
export async function evaluateCopdPatient(patientId: string, persist = false, prefetch?: unknown): Promise<CopdResult> {
  const input = await loadCopdData(patientId, new Date().toISOString(), prefetch);
  const result = evaluateCopd(input);
  if (persist) {
    if (!input.complete.DetectedIssue || !input.complete.Task) throw new Error("Issue/task history is incomplete; persistence deferred.");
    const transaction = findingTransaction(result.findings, input.now);
    if (transaction.entry?.length) {
      const response = await executeFhirTransaction(transaction);
      if (!transactionSucceeded(response.status, response.body)) throw new Error("Could not persist COPD findings and tasks atomically.");
      // Reload from the store (never the now-stale prefetch) to return real issue IDs and observe a concurrent clinician resolution.
      return evaluateCopd(await loadCopdData(patientId, input.now));
    }
  }
  return result;
}

export async function resolveCopdIssue(issue: fhir4.DetectedIssue, reason: string, actor: string): Promise<void> {
  const patientId = issue.patient?.reference?.split("/").pop();
  if (!patientIdValid(patientId) || !issue.id || !reason.trim()) throw new Error("Invalid COPD issue resolution.");
  const snapshot = await loadCopdData(patientId);
  if (!snapshot.complete.Task) throw new Error("Cannot resolve without complete task history.");
  const current = await readFhirResource<fhir4.DetectedIssue>("DetectedIssue", issue.id);
  if (current.status !== 200 || current.body?.resourceType !== "DetectedIssue" || !referencesPatient(current.body.patient, patientId) || !current.body.meta?.versionId) throw new Error("Issue changed or cannot be read safely.");
  const updated = current.body;
  const linked = snapshot.resources.filter((resource): resource is fhir4.Task => resource.resourceType === "Task").filter(resource => referencesPatient(resource.for, patientId) && resource.focus?.reference === `DetectedIssue/${issue.id}` && !["completed", "cancelled"].includes(resource.status));
  const now = new Date().toISOString();
  const resources: (fhir4.DetectedIssue | fhir4.Task)[] = [{ ...updated, status: "final", mitigation: updated.mitigation?.length ? updated.mitigation : [{ action: { text: `Clinician reviewed: ${reason.trim()}` }, author: { display: actor }, date: now }] }, ...linked.map(task => ({ ...task, status: "completed" as const, lastModified: now, note: [...(task.note ?? []), { text: `Resolved with DetectedIssue/${issue.id}: ${reason.trim()}`, authorString: actor, time: now }] }))];
  if (resources.some(resource => !resource.meta?.versionId)) throw new Error("Resource version missing; reload before resolving.");
  const response = await executeFhirTransaction({ resourceType: "Bundle", type: "transaction", entry: resources.map(resource => ({ resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}`, ifMatch: `W/\"${resource.meta!.versionId}\"` } })) });
  if (!transactionSucceeded(response.status, response.body)) throw new Error("Resolution conflict or failure; reload before retrying.");
}
