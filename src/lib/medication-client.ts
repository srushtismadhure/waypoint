import type { CdsHooksCard, MedicationPatientState } from "./medication-types";
import type { CreateDraftMedicationInput } from "./medications";

async function medFetch<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "include",
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Authentication required");
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((body as { error?: string })?.error ?? "The request could not be completed.");
  }
  return body as T;
}

export function getPatientMedicationState(patientId: string): Promise<MedicationPatientState> {
  return medFetch(`/api/patients/${encodeURIComponent(patientId)}/medications`);
}

export type DraftMedicationInput = Omit<CreateDraftMedicationInput, "patientId" | "prescriberDisplay">;

export function createMedicationDraft(patientId: string, input: DraftMedicationInput): Promise<fhir4.MedicationRequest> {
  return medFetch(`/api/patients/${encodeURIComponent(patientId)}/medication-drafts`, { method: "POST", body: input });
}

export interface SafetyEvaluationResult {
  cards: CdsHooksCard[];
  conflicts: { detectedIssueId: string; ruleId: string; severity: string; summary: string; medicationRequestId?: string }[];
}

export function evaluateMedicationSafety(patientId: string, draftMedicationRequest: fhir4.MedicationRequest): Promise<SafetyEvaluationResult> {
  return medFetch("/api/medication-safety/evaluate", { method: "POST", body: { patientId, draftMedicationRequest } });
}

export function signMedicationRequest(id: string): Promise<fhir4.MedicationRequest> {
  return medFetch(`/api/medication-requests/${encodeURIComponent(id)}/sign`, { method: "POST", body: {} });
}

export function holdMedicationRequest(id: string, reason: string): Promise<fhir4.MedicationRequest> {
  return medFetch(`/api/medication-requests/${encodeURIComponent(id)}/hold`, { method: "POST", body: { reason } });
}

export function stopMedicationRequest(id: string, reason: string): Promise<fhir4.MedicationRequest> {
  return medFetch(`/api/medication-requests/${encodeURIComponent(id)}/stop`, { method: "POST", body: { reason } });
}

export function replaceMedicationRequest(id: string, changes: Partial<DraftMedicationInput>): Promise<fhir4.MedicationRequest> {
  return medFetch(`/api/medication-requests/${encodeURIComponent(id)}/replace`, { method: "POST", body: changes });
}

export interface CreateStatementInput {
  medicationRequestId?: string;
  medicationText: string;
  status: fhir4.MedicationStatement["status"];
  doseText?: string;
  note?: string;
  reportedUse?: string;
}

export async function createMedicationStatement(patientId: string, input: CreateStatementInput): Promise<{ id: string; cdsWarning?: string }> {
  const result = await medFetch<{ id: string; cdsWarning?: string }>(`/api/patients/${encodeURIComponent(patientId)}/medication-statements`, { method: "POST", body: input });
  window.dispatchEvent(new Event("waypoint:medication-reconciled"));
  return result;
}

export interface SymptomAnswerInput {
  linkId: string;
  text: string;
  severity: "none" | "mild" | "moderate" | "severe";
  startDate?: string;
  trend?: "improving" | "unchanged" | "worsening";
  suspectedMedication?: string;
}

export function createMedicationAssessment(patientId: string, answers: SymptomAnswerInput[]): Promise<{ id: string }> {
  return medFetch(`/api/patients/${encodeURIComponent(patientId)}/medication-assessments`, { method: "POST", body: { answers } });
}

export function resolveDetectedIssue(id: string, action: "modify" | "cancel" | "continue" | "create-task", reason: string): Promise<{ ok: true }> {
  return medFetch(`/api/detected-issues/${encodeURIComponent(id)}/resolve`, { method: "POST", body: { action, reason } });
}
