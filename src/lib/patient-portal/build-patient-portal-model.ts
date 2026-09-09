import { formatPatientName } from "../formatters.js";
import { buildDashboardSummary } from "./build-dashboard-summary.js";
import { normalizeAppointments } from "./normalize-appointments.js";
import { normalizeCarePlan } from "./normalize-care-plan.js";
import { normalizeCareTeamForPortal } from "./normalize-care-team.js";
import { normalizeCopdOverview } from "./normalize-copd.js";
import { normalizeDocuments } from "./normalize-documents.js";
import { normalizeMedications } from "./normalize-medications.js";
import { normalizePatientMessages } from "./normalize-messages.js";
import type { PatientPortalModel, PatientPortalRawData } from "./types.js";

function isSynthetic(patient: fhir4.Patient): boolean {
  return `${patient.text?.div ?? ""} ${patient.meta?.tag?.map(tag => tag.display ?? tag.code).join(" ") ?? ""}`.toLowerCase().includes("synthetic");
}

export function buildPatientPortalModel(raw: PatientPortalRawData, now = new Date()): PatientPortalModel {
  const displayName = formatPatientName(raw.patient);
  const firstName = raw.patient.name?.[0]?.given?.[0] ?? displayName.split(" ")[0] ?? "there";
  const appointments = normalizeAppointments(raw.appointments, now);
  const medications = normalizeMedications(raw.medicationRequests, raw.medicationStatements);
  const carePlan = normalizeCarePlan(raw.carePlans, raw.serviceRequests);
  const careTeam = normalizeCareTeamForPortal(raw.careTeams);
  const messages = normalizePatientMessages(raw.communications, raw.patient.id ?? "");
  const documents = normalizeDocuments(raw.documentReferences);
  const copdOverview = normalizeCopdOverview({
    conditions: raw.conditions,
    observations: raw.observations,
    encounters: raw.encounters,
    serviceRequests: raw.serviceRequests,
    appointments: raw.appointments,
    medicationRequests: raw.medicationRequests,
    medicationStatements: raw.medicationStatements,
  });

  const lastUpdatedAt = [
    raw.patient.meta?.lastUpdated,
    ...raw.observations.map(item => item.meta?.lastUpdated ?? item.effectiveDateTime ?? item.issued),
    ...raw.encounters.map(item => item.meta?.lastUpdated ?? item.period?.end ?? item.period?.start),
    ...raw.questionnaireResponses.map(item => item.meta?.lastUpdated ?? item.authored),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop() ?? now.toISOString();

  const incompleteSections: string[] = [];
  if (copdOverview.diagnosis.label === "COPD diagnosis not available") incompleteSections.push("COPD diagnosis information");
  if (!copdOverview.respiratory.spo2 && !copdOverview.respiratory.dyspnea && !copdOverview.respiratory.oxygen) incompleteSections.push("Recent breathing information");
  if (medications.length === 0) incompleteSections.push("Medication list");
  if (careTeam.length === 0) incompleteSections.push("Care team");
  if (appointments.length === 0) incompleteSections.push("Appointments");

  return {
    patient: { firstName, displayName, synthetic: isSynthetic(raw.patient) },
    dashboard: buildDashboardSummary({
      copd: copdOverview,
      carePlan,
      appointments,
      medications,
      messages,
      coordinator: careTeam.find(member => /coordinator|case|nurse/i.test(member.role))?.name ?? "Care team",
    }),
    copdOverview,
    carePlan,
    appointments,
    medications,
    careTeam,
    messages,
    documents,
    dataStatus: {
      lastUpdatedAt,
      incompleteSections,
      failedSections: raw.failedSections,
    },
  };
}
