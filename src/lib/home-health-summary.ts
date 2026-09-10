/**
 * Clinician-facing home-health summary.
 *
 * Read-only normalization of a completed home-health visit: what the nurse documented and what a
 * clinician needs to act on. Nurse authoring (recording, transcription, OASIS entry, finalizing)
 * stays in the nurse workspace and is never represented here.
 */
import { COPD_HOME_HEALTH_QUESTIONNAIRE } from "./copd-cds";
import { referencesPatient } from "./formatters";

export const OASIS_QUESTIONNAIRE_FRAGMENT = "oasis-e2";
export const CLINICAL_NOTE_TYPE_CODE = "clinical-note-draft";

export type AssessmentState = "completed" | "in-progress" | "not-started";

export interface AssessmentStatus {
  label: string;
  state: AssessmentState;
  detail?: string;
}

export interface HomeHealthFinding {
  label: string;
  value: string;
  source: string;
}

export interface HomeHealthVisitSummary {
  encounterId: string;
  date: string;
  status: string;
  clinician: string;
  visitType?: string;
  /** Days since the most recent inpatient discharge, when one is on file. */
  postDischargeDay?: number;
}

export interface FinalizedNote {
  id: string;
  date?: string;
  title: string;
  author?: string;
}

export interface HomeHealthSummary {
  visit?: HomeHealthVisitSummary;
  assessments: AssessmentStatus[];
  findings: HomeHealthFinding[];
  finalizedNote?: FinalizedNote;
}

export interface HomeHealthSummaryInput {
  patientId: string;
  encounters?: fhir4.Encounter[];
  questionnaireResponses?: fhir4.QuestionnaireResponse[];
  documentReferences?: fhir4.DocumentReference[];
  observations?: fhir4.Observation[];
}

/** Clinician-relevant answers only; the nurse form has more fields than a reviewing clinician needs. */
const FINDING_FIELDS: { linkId: string; label: string }[] = [
  { linkId: "spo2", label: "SpO2" },
  { linkId: "respiratory-rate", label: "Respiratory rate" },
  { linkId: "mmrc", label: "Dyspnea (mMRC)" },
  { linkId: "breathing-baseline", label: "Breathing vs baseline" },
  { linkId: "oxygen-use", label: "Oxygen use" },
  { linkId: "oxygen-flow", label: "Oxygen flow rate" },
  { linkId: "rescue-inhaler", label: "Rescue inhaler use" },
  { linkId: "functional", label: "Functional status" },
  { linkId: "pulmonology", label: "Pulmonology follow-up" },
  { linkId: "rehab", label: "Pulmonary rehabilitation" },
];

function day(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : undefined;
}

function assessmentState(response: fhir4.QuestionnaireResponse | undefined): AssessmentState {
  if (!response) return "not-started";
  return ["completed", "amended"].includes(response.status) ? "completed" : "in-progress";
}

function latestBy<T>(items: T[], key: (item: T) => string | undefined): T | undefined {
  return [...items].sort((a, b) => (key(a) ?? "").localeCompare(key(b) ?? "")).pop();
}

export function buildHomeHealthSummary(input: HomeHealthSummaryInput): HomeHealthSummary {
  const encounters = (input.encounters ?? []).filter(item => referencesPatient(item.subject, input.patientId));
  const responses = (input.questionnaireResponses ?? []).filter(item => referencesPatient(item.subject, input.patientId));
  const documents = (input.documentReferences ?? []).filter(item => referencesPatient(item.subject, input.patientId));

  const homeHealthVisits = encounters.filter(item => item.class?.code === "HH" && item.status === "finished");
  const encounter = latestBy(homeHealthVisits, item => item.period?.end ?? item.period?.start ?? "");
  const discharge = latestBy(
    encounters.filter(item => item.class?.code === "IMP" && item.status === "finished" && item.period?.end),
    item => item.period!.end!,
  );

  const visitDate = day(encounter?.period?.end ?? encounter?.period?.start);
  let visit: HomeHealthVisitSummary | undefined;
  if (encounter?.id && visitDate) {
    const dischargeDate = day(discharge?.period?.end);
    visit = {
      encounterId: encounter.id,
      date: visitDate,
      status: encounter.status,
      clinician: encounter.participant?.[0]?.individual?.display ?? "Home Health RN",
      visitType: encounter.type?.[0]?.text,
      ...(dischargeDate && Date.parse(visitDate) >= Date.parse(dischargeDate)
        ? { postDischargeDay: Math.round((Date.parse(visitDate) - Date.parse(dischargeDate)) / 86400000) }
        : {}),
    };
  }

  // Only answers from the visit being summarized are shown, so a clinician never mixes two visits.
  // OASIS responses are re-saved without an encounter link, so an unlinked response counts when it post-dates the visit.
  const visitStart = encounter?.period?.start ?? encounter?.period?.end;
  const visitResponses = responses.filter(item => {
    if (!encounter?.id) return false;
    if (item.encounter?.reference) return item.encounter.reference === `Encounter/${encounter.id}`;
    return !!visitStart && !!item.authored && Date.parse(item.authored) >= Date.parse(visitStart);
  });
  const copdResponse = latestBy(visitResponses.filter(item => item.questionnaire === COPD_HOME_HEALTH_QUESTIONNAIRE), item => item.authored ?? "");
  const oasisResponse = latestBy(visitResponses.filter(item => item.questionnaire?.includes(OASIS_QUESTIONNAIRE_FRAGMENT)), item => item.authored ?? "");

  const finalized = latestBy(
    documents.filter(item => item.docStatus === "final" && item.type?.coding?.some(coding => coding.code === CLINICAL_NOTE_TYPE_CODE)),
    item => item.date ?? "",
  );

  const findings: HomeHealthFinding[] = FINDING_FIELDS.flatMap(field => {
    const value = copdResponse?.item?.find(item => item.linkId === field.linkId)?.answer?.[0]?.valueString?.trim();
    return value ? [{ label: field.label, value, source: copdResponse?.author?.display ?? "Home Health RN" }] : [];
  });

  return {
    visit,
    assessments: [
      { label: "COPD assessment", state: assessmentState(copdResponse), detail: day(copdResponse?.authored) },
      { label: "OASIS-E2", state: assessmentState(oasisResponse), detail: day(oasisResponse?.authored) },
      { label: "Clinical note", state: finalized ? "completed" : "not-started", detail: finalized ? "Finalized" : "Not finalized" },
    ],
    findings,
    ...(finalized?.id
      ? { finalizedNote: { id: finalized.id, date: day(finalized.date), title: finalized.type?.text ?? finalized.description ?? "Home-health clinical note", author: finalized.author?.[0]?.display } }
      : {}),
  };
}

export type RehabStatus = "not-referred" | "referral-recommended" | "referral-placed" | "intake-scheduled" | "enrolled" | "completed";

export const REHAB_STATUS_LABELS: Record<RehabStatus, string> = {
  "not-referred": "Not referred",
  "referral-recommended": "Referral recommended",
  "referral-placed": "Referral placed",
  "intake-scheduled": "Intake scheduled",
  enrolled: "Enrolled",
  completed: "Completed",
};

export interface RehabSummary {
  status: RehabStatus;
  rationale: string[];
  referenceResources: string[];
  nextAppointment?: string;
}

export interface RehabSummaryInput {
  patientId: string;
  serviceRequests?: fhir4.ServiceRequest[];
  carePlans?: fhir4.CarePlan[];
  appointments?: fhir4.Appointment[];
  encounters?: fhir4.Encounter[];
  copdFindingRuleIds?: string[];
}

const REHAB_PATTERN = /pulmonary[- ]rehab/i;

function mentionsRehab(concept: fhir4.CodeableConcept | undefined): boolean {
  return REHAB_PATTERN.test(`${concept?.text ?? ""} ${concept?.coding?.map(coding => `${coding.code ?? ""} ${coding.display ?? ""}`).join(" ") ?? ""}`);
}

/** Status is read from documented resources only; the CDS gap rule can recommend, never enroll. */
export function buildRehabSummary(input: RehabSummaryInput): RehabSummary {
  const requests = (input.serviceRequests ?? []).filter(item => referencesPatient(item.subject, input.patientId) && mentionsRehab(item.code));
  const plans = (input.carePlans ?? []).filter(item => referencesPatient(item.subject, input.patientId) && item.activity?.some(activity => mentionsRehab(activity.detail?.code)));
  const appointments = (input.appointments ?? []).filter(
    item => item.participant?.some(person => referencesPatient(person.actor, input.patientId)) && item.serviceType?.some(mentionsRehab),
  );
  const booked = latestBy(appointments.filter(item => ["booked", "arrived", "checked-in"].includes(item.status) && item.start), item => item.start!);
  const recentHospitalization = (input.encounters ?? []).some(
    item => referencesPatient(item.subject, input.patientId) && item.class?.code === "IMP" && item.status === "finished",
  );

  const rationale: string[] = [];
  if (recentHospitalization) rationale.push("A COPD hospitalization is documented for this patient.");
  if (input.copdFindingRuleIds?.includes("pulmonary-rehab-gap")) rationale.push("The COPD rule engine has an open pulmonary rehabilitation gap finding.");

  let status: RehabStatus = "not-referred";
  if (plans.some(plan => plan.status === "completed") || requests.some(request => request.status === "completed")) status = "completed";
  else if (plans.some(plan => plan.status === "active")) status = "enrolled";
  else if (booked) status = "intake-scheduled";
  else if (requests.some(request => ["active", "on-hold", "draft"].includes(request.status))) status = "referral-placed";
  else if (rationale.length) status = "referral-recommended";

  return {
    status,
    rationale,
    referenceResources: [
      ...requests.map(item => `ServiceRequest/${item.id}`),
      ...plans.map(item => `CarePlan/${item.id}`),
      ...appointments.map(item => `Appointment/${item.id}`),
    ],
    ...(booked?.start ? { nextAppointment: day(booked.start) } : {}),
  };
}
