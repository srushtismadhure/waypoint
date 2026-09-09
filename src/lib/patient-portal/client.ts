import type {
  PatientAppointment,
  PatientCarePathway,
  PatientCareTeamMember,
  PatientCopdOverview,
  PatientDashboardSummary,
  PatientDocument,
  PatientIdentity,
  PatientMedication,
  PatientMessageSummary,
} from "./types.js";

export interface PortalDataStatus {
  lastUpdatedAt: string;
  incompleteSections: string[];
  failedSections: string[];
}

export interface PortalBaseResponse {
  patient: PatientIdentity;
  dataStatus: PortalDataStatus;
}

export type PortalSummaryResponse = PortalBaseResponse & { dashboard: PatientDashboardSummary };
export type PortalCopdResponse = PortalBaseResponse & { copd: PatientCopdOverview };
export type PortalCarePlanResponse = PortalBaseResponse & { pathways: PatientCarePathway[] };
export type PortalAppointmentsResponse = PortalBaseResponse & { appointments: PatientAppointment[] };
export type PortalMedicationsResponse = PortalBaseResponse & { medications: PatientMedication[] };
export type PortalCareTeamResponse = PortalBaseResponse & { members: PatientCareTeamMember[] };
export type PortalMessagesResponse = PortalBaseResponse & { messages: PatientMessageSummary[] };
export type PortalDocumentsResponse = PortalBaseResponse & { documents: PatientDocument[] };

async function portalRequest<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`/api/portal/${path}`, {
    method: init?.method ?? "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (response.status === 401) window.location.replace("/login");
  if (!response.ok) throw new Error(body?.error ?? "We could not complete this request.");
  return body as T;
}

export function getPortalSummary() { return portalRequest<PortalSummaryResponse>("summary"); }
export function getPortalCopd() { return portalRequest<PortalCopdResponse>("copd"); }
export function getPortalCarePlan() { return portalRequest<PortalCarePlanResponse>("care-plan"); }
export function getPortalAppointments() { return portalRequest<PortalAppointmentsResponse>("appointments"); }
export function getPortalMedications() { return portalRequest<PortalMedicationsResponse>("medications"); }
export function getPortalCareTeam() { return portalRequest<PortalCareTeamResponse>("care-team"); }
export function getPortalMessages() { return portalRequest<PortalMessagesResponse>("messages"); }
export function getPortalDocuments() { return portalRequest<PortalDocumentsResponse>("documents"); }

export function requestAppointmentChange(appointmentId: string, requestType: string, message?: string) {
  return portalRequest<{ ok: true; requestId: string }>("appointments/change-request", { method: "POST", body: { appointmentId, requestType, message } });
}
export function requestMedicationRefill(medicationRequestId: string, message?: string) {
  return portalRequest<{ ok: true; requestId: string }>("medications/refill-request", { method: "POST", body: { medicationRequestId, message } });
}
export function sendPortalMessage(category: string, subject: string, message: string) {
  return portalRequest<{ ok: true; messageId: string }>("messages", { method: "POST", body: { category, subject, message } });
}
