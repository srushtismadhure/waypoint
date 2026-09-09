import { formatConditionText } from "../formatters.js";
import { normalizeAppointments } from "./normalize-appointments.js";
import type { PatientCopdOverview, PatientRespiratoryMetric } from "./types.js";

const WAYPOINT_COPD_SYSTEM = "https://waypoint.example/fhir/CodeSystem/copd-demo";

function observationText(observation: fhir4.Observation): string | undefined {
  if (observation.valueQuantity?.value !== undefined) {
    return `${observation.valueQuantity.value}${observation.valueQuantity.unit ? ` ${observation.valueQuantity.unit}` : ""}`;
  }
  if (observation.valueInteger !== undefined) return String(observation.valueInteger);
  return observation.valueString ?? observation.valueCodeableConcept?.text ?? observation.valueCodeableConcept?.coding?.[0]?.display;
}

function observationDate(observation: fhir4.Observation): string | undefined {
  return observation.effectiveDateTime ?? observation.issued;
}

function latestObservation(observations: fhir4.Observation[], system: string, code: string, label: string): PatientRespiratoryMetric | undefined {
  const observation = observations
    .filter(item => item.code?.coding?.some(coding => coding.system === system && coding.code === code))
    .sort((a, b) => (observationDate(b) ?? "").localeCompare(observationDate(a) ?? ""))[0];
  const value = observation ? observationText(observation) : undefined;
  return observation && value ? { label, value, date: observationDate(observation), source: `Observation/${observation.id ?? "unknown"}` } : undefined;
}

function encounterText(encounter: fhir4.Encounter): string {
  return `${encounter.type?.map(item => `${item.text ?? ""} ${item.coding?.map(code => code.display ?? code.code ?? "").join(" ") ?? ""}`).join(" ") ?? ""} ${encounter.reasonCode?.map(reason => reason.text ?? "").join(" ") ?? ""}`.toLowerCase();
}

function requestText(request: fhir4.ServiceRequest): string {
  return `${request.code?.text ?? ""} ${request.code?.coding?.map(code => `${code.display ?? ""} ${code.code ?? ""}`).join(" ") ?? ""}`.toLowerCase();
}

export function normalizeCopdOverview(input: {
  conditions: fhir4.Condition[];
  observations: fhir4.Observation[];
  encounters: fhir4.Encounter[];
  serviceRequests: fhir4.ServiceRequest[];
  appointments: fhir4.Appointment[];
  medicationRequests: fhir4.MedicationRequest[];
  medicationStatements: fhir4.MedicationStatement[];
}): PatientCopdOverview {
  const copdCondition = input.conditions.find(condition => /copd|chronic obstructive pulmonary disease/i.test(formatConditionText(condition)));
  const spo2 = latestObservation(input.observations, "http://loinc.org", "59408-5", "Oxygen saturation");
  const respiratoryRate = latestObservation(input.observations, "http://loinc.org", "9279-1", "Respiratory rate");
  const dyspnea = latestObservation(input.observations, WAYPOINT_COPD_SYSTEM, "mmrc-dyspnea", "Breathlessness (mMRC)");
  const oxygen = latestObservation(input.observations, WAYPOINT_COPD_SYSTEM, "oxygen-use", "Home oxygen");
  const breathingComparedWithBaseline = latestObservation(input.observations, WAYPOINT_COPD_SYSTEM, "breathing-baseline", "Breathing compared with usual");
  const fev1Percent = latestObservation(input.observations, "http://loinc.org", "19868-9", "FEV1 percent predicted");
  const fev1Fvc = latestObservation(input.observations, "http://loinc.org", "19926-5", "FEV1/FVC");
  const fev1Value = fev1Percent ? Number.parseFloat(fev1Percent.value) : Number.NaN;
  const airflowCategory = Number.isFinite(fev1Value)
    ? fev1Value >= 80 ? "GOLD 1 airflow limitation" : fev1Value >= 50 ? "GOLD 2 airflow limitation" : fev1Value >= 30 ? "GOLD 3 airflow limitation" : "GOLD 4 airflow limitation"
    : undefined;

  const exacerbationEncounters = input.encounters.filter(encounter => /exacerbation|hypoxemia|copd flare/.test(encounterText(encounter)));
  const recent = exacerbationEncounters
    .map(encounter => ({
      id: encounter.id ?? crypto.randomUUID(),
      label: encounter.type?.[0]?.text ?? encounter.reasonCode?.[0]?.text ?? "COPD-related encounter",
      date: encounter.period?.start ?? encounter.period?.end,
      setting: encounter.class?.display ?? encounter.class?.code ?? "Encounter",
    }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 3);

  const homeHealthEncounters = input.encounters.filter(encounter => encounter.class?.code === "HH" || /home health/.test(encounterText(encounter)));
  const latestHomeHealth = [...homeHealthEncounters].sort((a, b) => (b.period?.start ?? "").localeCompare(a.period?.start ?? ""))[0];
  const homeHealthSummary = [spo2, dyspnea, oxygen, breathingComparedWithBaseline]
    .filter((item): item is PatientRespiratoryMetric => Boolean(item))
    .map(item => `${item.label}: ${item.value}`);

  const rehabRequest = input.serviceRequests.find(request => /pulmonary rehab|pulmonary rehabilitation/.test(requestText(request)));
  const activeRehab = Boolean(rehabRequest && !["completed", "revoked", "entered-in-error"].includes(rehabRequest.status));

  const appointments = normalizeAppointments(input.appointments);
  const nextAppointment = appointments.find(item => !item.past && item.status !== "cancelled");
  const pulmonaryAppointment = appointments.find(item => !item.past && /pulmon|respirat|copd/.test(`${item.title} ${item.provider}`.toLowerCase()));

  const notTaken = input.medicationStatements.find(statement => statement.status === "not-taken");
  const activeMedicationCount = input.medicationRequests.filter(request => request.status === "active").length;

  return {
    diagnosis: {
      label: copdCondition ? formatConditionText(copdCondition) : "COPD diagnosis not available",
      status: copdCondition?.clinicalStatus?.coding?.[0]?.code ?? "unknown",
      onset: copdCondition?.onsetDateTime ?? (typeof copdCondition?.onsetString === "string" ? copdCondition.onsetString : undefined),
    },
    respiratory: { spo2, respiratoryRate, dyspnea, oxygen, breathingComparedWithBaseline },
    lungFunction: { fev1Percent, fev1Fvc, airflowCategory },
    exacerbations: { supported: input.encounters.length > 0, count: exacerbationEncounters.length, recent },
    homeHealth: {
      status: homeHealthEncounters.length > 0 ? "Home-health follow-up documented" : "No home-health visit documented",
      latestVisitDate: latestHomeHealth?.period?.start ?? latestHomeHealth?.period?.end,
      summary: homeHealthSummary,
    },
    pulmonaryRehab: {
      status: activeRehab ? "Referral documented" : "No active referral documented",
      detail: rehabRequest?.code?.text ?? (activeRehab ? "Pulmonary rehabilitation referral is active." : "Ask your care team whether pulmonary rehabilitation is appropriate for you."),
    },
    followUp: {
      status: pulmonaryAppointment ? "Pulmonary follow-up scheduled" : nextAppointment ? "Upcoming care appointment documented" : "No upcoming appointment documented",
      detail: pulmonaryAppointment ? `${pulmonaryAppointment.title}${pulmonaryAppointment.start ? ` on ${new Date(pulmonaryAppointment.start).toLocaleDateString()}` : ""}` : "Review appointments or message your care team if you expected follow-up.",
      nextAppointment: pulmonaryAppointment ?? nextAppointment,
    },
    medicationCheck: {
      status: notTaken ? "Medication issue documented" : activeMedicationCount > 0 ? "Medication list available" : "Medication information incomplete",
      detail: notTaken ? "Your record includes a medication that you reported not taking. Contact your care team if this has not been resolved." : `${activeMedicationCount} active medication${activeMedicationCount === 1 ? "" : "s"} listed in your record.`,
    },
  };
}
