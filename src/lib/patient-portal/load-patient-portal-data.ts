import { loadCareCoordinationData } from "../care-coordination/load-care-coordination-data.js";
import { searchFhirResource } from "../fhir-server-client.js";
import type { PatientPortalRawData } from "./types.js";

function bundleResources<T extends fhir4.Resource>(body: fhir4.Bundle | fhir4.OperationOutcome, resourceType: T["resourceType"]): T[] {
  if (body.resourceType !== "Bundle") return [];
  return (body.entry ?? []).map(entry => entry.resource).filter((resource): resource is T => resource?.resourceType === resourceType);
}

async function safeSearch<T extends fhir4.Resource>(resourceType: T["resourceType"], patientId: string, suffix = "") {
  const base = `patient=${encodeURIComponent(patientId)}`;
  let result = await searchFhirResource<fhir4.Bundle | fhir4.OperationOutcome>(resourceType, `${base}${suffix}`);
  if (result.status >= 400 && suffix) result = await searchFhirResource<fhir4.Bundle | fhir4.OperationOutcome>(resourceType, base);
  return result.status === 200 && result.body.resourceType === "Bundle"
    ? { resources: bundleResources<T>(result.body, resourceType), failed: false }
    : { resources: [] as T[], failed: true };
}

export async function loadPatientPortalData(patientId: string): Promise<PatientPortalRawData> {
  const careRaw = await loadCareCoordinationData(patientId);
  const [medicationRequests, medicationStatements, documentReferences, questionnaireResponses] = await Promise.all([
    safeSearch<fhir4.MedicationRequest>("MedicationRequest", patientId, "&_sort=-authored&_count=100"),
    safeSearch<fhir4.MedicationStatement>("MedicationStatement", patientId, "&_count=100"),
    safeSearch<fhir4.DocumentReference>("DocumentReference", patientId, "&_sort=-date&_count=100"),
    safeSearch<fhir4.QuestionnaireResponse>("QuestionnaireResponse", patientId, "&_sort=-authored&_count=100"),
  ]);

  const failedSections = [...careRaw.failedSections];
  if (medicationRequests.failed) failedSections.push("MedicationRequest");
  if (medicationStatements.failed) failedSections.push("MedicationStatement");
  if (documentReferences.failed) failedSections.push("DocumentReference");
  if (questionnaireResponses.failed) failedSections.push("QuestionnaireResponse");

  return {
    patient: careRaw.patient,
    conditions: careRaw.conditions,
    observations: careRaw.observations,
    medicationRequests: medicationRequests.resources,
    medicationStatements: medicationStatements.resources,
    serviceRequests: careRaw.serviceRequests,
    carePlans: careRaw.carePlans,
    goals: careRaw.goals,
    appointments: careRaw.appointments,
    encounters: careRaw.encounters,
    careTeams: careRaw.careTeams,
    communications: careRaw.communications,
    documentReferences: documentReferences.resources,
    questionnaireResponses: questionnaireResponses.resources,
    failedSections: [...new Set(failedSections)],
  };
}
