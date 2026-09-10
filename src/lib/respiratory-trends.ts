/**
 * Longitudinal COPD respiratory trend normalization.
 *
 * Pure functions over FHIR resources: no I/O, no alerting. The deterministic COPD CDS engine
 * (copd-cds.ts) decides whether an actionable finding exists; this module only describes what the
 * recorded measurements did over time so a clinician can see the evidence behind that decision.
 */
import { COPD_DEMO_SYSTEM, COPD_HOME_HEALTH_QUESTIONNAIRE } from "./copd-cds";
import { referencesPatient } from "./formatters";
import { LOINC_SYSTEM } from "./fhir-observations";

export type RespiratoryMetricKey = "spo2" | "respiratoryRate" | "mmrc" | "rescueUse";
export type MeasurementSource = "home-health" | "ambulatory" | "hospital" | "clinical-record";

export interface MetricDefinition {
  key: RespiratoryMetricKey;
  title: string;
  unit: string;
  /** Direction that represents clinical worsening. */
  worseningDirection: "up" | "down";
  /** Absolute change from first to latest value that counts as a directional signal. */
  changeThreshold: number;
  system: string;
  code: string;
  /** linkId on the COPD home-health QuestionnaireResponse carrying the same measurement. */
  linkId: string;
  axisHint?: string;
  helpText?: string;
}

export const RESPIRATORY_METRICS: readonly MetricDefinition[] = [
  { key: "spo2", title: "Oxygen Saturation", unit: "%", worseningDirection: "down", changeThreshold: 2, system: LOINC_SYSTEM, code: "59408-5", linkId: "spo2" },
  { key: "respiratoryRate", title: "Respiratory Rate", unit: "breaths/min", worseningDirection: "up", changeThreshold: 3, system: LOINC_SYSTEM, code: "9279-1", linkId: "respiratory-rate" },
  { key: "mmrc", title: "Dyspnea (mMRC)", unit: "mMRC grade", worseningDirection: "up", changeThreshold: 1, system: COPD_DEMO_SYSTEM, code: "mmrc-dyspnea", linkId: "mmrc", axisHint: "0–4", helpText: "Higher score = greater breathlessness." },
  { key: "rescueUse", title: "Rescue Inhaler Use", unit: "uses/day", worseningDirection: "up", changeThreshold: 2, system: COPD_DEMO_SYSTEM, code: "rescue-inhaler-uses-per-day", linkId: "rescue-inhaler-uses" },
];

export const SOURCE_LABELS: Record<MeasurementSource, string> = {
  "home-health": "Home Health RN",
  ambulatory: "Ambulatory",
  hospital: "Hospital",
  "clinical-record": "Clinical record",
};

export interface TrendPoint {
  date: string;
  value: number;
  source: MeasurementSource;
  sourceLabel: string;
  resource: string;
}

export interface MetricSeries {
  definition: MetricDefinition;
  points: TrendPoint[];
}

const ENCOUNTER_CLASS_SOURCE: Record<string, MeasurementSource> = { HH: "home-health", IMP: "hospital", ACUTE: "hospital", EMER: "hospital", AMB: "ambulatory" };

/** Only a leading number is trusted: "90 %" and "22 breaths/min" are values, "Worse" is not. */
export function parseLeadingNumber(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = /^\s*(-?\d+(?:\.\d+)?)/.exec(text);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function dayOf(value: string | undefined): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? value.slice(0, 10) : undefined;
}

function encounterSource(reference: string | undefined, encounters: fhir4.Encounter[]): MeasurementSource | undefined {
  const id = reference?.split("/").pop();
  const encounter = id ? encounters.find(item => item.id === id) : undefined;
  return encounter?.class?.code ? ENCOUNTER_CLASS_SOURCE[encounter.class.code] : undefined;
}

function performerSource(displays: (string | undefined)[]): MeasurementSource | undefined {
  return displays.some(display => /home health|home-health|\bRN\b/i.test(display ?? "")) ? "home-health" : undefined;
}

function observationValue(observation: fhir4.Observation): number | undefined {
  if (observation.valueQuantity?.value !== undefined) return observation.valueQuantity.value;
  if (observation.valueInteger !== undefined) return observation.valueInteger;
  return parseLeadingNumber(observation.valueString);
}

function point(date: string, value: number, source: MeasurementSource, resource: string): TrendPoint {
  return { date, value, source, sourceLabel: SOURCE_LABELS[source], resource };
}

/**
 * Builds one chronological series per metric from Observations and, for measurements a nurse
 * recorded on the home-health questionnaire, the QuestionnaireResponse. Every resource is
 * re-checked against `patientId` so another patient's data can never enter a chart.
 */
export function buildRespiratorySeries(
  patientId: string,
  observations: fhir4.Observation[],
  questionnaireResponses: fhir4.QuestionnaireResponse[] = [],
  encounters: fhir4.Encounter[] = [],
): MetricSeries[] {
  const scopedObservations = observations.filter(item => referencesPatient(item.subject, patientId) && ["final", "amended", "corrected"].includes(item.status));
  const scopedResponses = questionnaireResponses.filter(
    item => referencesPatient(item.subject, patientId) && item.questionnaire === COPD_HOME_HEALTH_QUESTIONNAIRE && ["completed", "amended"].includes(item.status),
  );
  const scopedEncounters = encounters.filter(item => referencesPatient(item.subject, patientId));

  return RESPIRATORY_METRICS.map(definition => {
    const byDate = new Map<string, TrendPoint>();

    for (const response of scopedResponses) {
      const date = dayOf(response.authored);
      const value = parseLeadingNumber(response.item?.find(item => item.linkId === definition.linkId)?.answer?.[0]?.valueString);
      if (!date || value === undefined) continue;
      const source = encounterSource(response.encounter?.reference, scopedEncounters) ?? performerSource([response.author?.display]) ?? "home-health";
      byDate.set(date, point(date, value, source, `QuestionnaireResponse/${response.id}`));
    }

    // Observations are written last so a confirmed structured measurement wins over the questionnaire text.
    for (const observation of scopedObservations) {
      if (!observation.code?.coding?.some(coding => coding.system === definition.system && coding.code === definition.code)) continue;
      const date = dayOf(observation.effectiveDateTime ?? observation.effectivePeriod?.start ?? observation.issued);
      const value = observationValue(observation);
      if (!date || value === undefined) continue;
      const source = encounterSource(observation.encounter?.reference, scopedEncounters) ?? performerSource((observation.performer ?? []).map(item => item.display)) ?? "clinical-record";
      byDate.set(date, point(date, value, source, `Observation/${observation.id}`));
    }

    return { definition, points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

export type Trajectory = "improving" | "stable" | "worsening" | "insufficient-data";

export interface DirectionalSignal {
  metric: RespiratoryMetricKey;
  direction: "worsening" | "improving";
  description: string;
}

export interface TrajectorySummary {
  trajectory: Trajectory;
  signals: DirectionalSignal[];
  /** Metrics with at least two measurements, i.e. the ones a direction could be read from. */
  comparedMetrics: number;
}

function describe(definition: MetricDefinition, first: TrendPoint, latest: TrendPoint, direction: "worsening" | "improving"): string {
  const verb = definition.worseningDirection === "down" ? (direction === "worsening" ? "declining" : "rising") : direction === "worsening" ? "increasing" : "decreasing";
  return `${definition.title} ${verb}: ${first.value} → ${latest.value} ${definition.unit} between ${first.date} and ${latest.date}.`;
}

/**
 * Compares the earliest and latest measurement of each metric against its configured threshold.
 * A single reading, or a change smaller than the threshold, is never called a trend.
 */
export function computeTrajectory(series: MetricSeries[]): TrajectorySummary {
  const signals: DirectionalSignal[] = [];
  let comparedMetrics = 0;

  for (const { definition, points } of series) {
    if (points.length < 2) continue;
    comparedMetrics++;
    const first = points[0]!;
    const latest = points[points.length - 1]!;
    const change = latest.value - first.value;
    if (Math.abs(change) < definition.changeThreshold) continue;
    const rising = change > 0;
    const direction = (definition.worseningDirection === "up") === rising ? "worsening" : "improving";
    signals.push({ metric: definition.key, direction, description: describe(definition, first, latest, direction) });
  }

  if (!comparedMetrics) return { trajectory: "insufficient-data", signals, comparedMetrics };
  const worsening = signals.some(signal => signal.direction === "worsening");
  const improving = signals.some(signal => signal.direction === "improving");
  // Mixed directions are not a trajectory claim; the clinician sees both signals instead.
  if (worsening && improving) return { trajectory: "stable", signals, comparedMetrics };
  return { trajectory: worsening ? "worsening" : improving ? "improving" : "stable", signals, comparedMetrics };
}

export interface LatestReading {
  definition: MetricDefinition;
  point?: TrendPoint;
}

export function latestReadings(series: MetricSeries[]): LatestReading[] {
  return series.map(({ definition, points }) => ({ definition, point: points[points.length - 1] }));
}

export function latestObservationPoint(series: MetricSeries[]): TrendPoint | undefined {
  return series
    .flatMap(item => item.points)
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
}

export type ClinicalEventKind = "exacerbation" | "admission" | "discharge" | "home-health" | "ambulatory" | "finding" | "task" | "referral";

export interface ClinicalEvent {
  date: string;
  kind: ClinicalEventKind;
  label: string;
  detail?: string;
  resource: string;
}

export interface ClinicalEventInput {
  patientId: string;
  encounters?: fhir4.Encounter[];
  conditions?: fhir4.Condition[];
  detectedIssues?: fhir4.DetectedIssue[];
  tasks?: fhir4.Task[];
  serviceRequests?: fhir4.ServiceRequest[];
  questionnaireResponses?: fhir4.QuestionnaireResponse[];
}

const EXACERBATION_PATTERN = /exacerbation|hypoxemia|respiratory failure/i;

function conceptText(concepts: (fhir4.CodeableConcept | undefined)[]): string {
  return concepts.map(concept => `${concept?.text ?? ""} ${concept?.coding?.map(coding => `${coding.display ?? ""} ${coding.code ?? ""}`).join(" ") ?? ""}`).join(" ");
}

/** Significant care events only — individual measurements belong on the charts, not the timeline. */
export function buildClinicalEvents(input: ClinicalEventInput): ClinicalEvent[] {
  const events: ClinicalEvent[] = [];
  const push = (date: string | undefined, kind: ClinicalEventKind, label: string, resource: string, detail?: string) => {
    const day = dayOf(date);
    if (day) events.push({ date: day, kind, label, resource, ...(detail ? { detail } : {}) });
  };

  for (const encounter of input.encounters ?? []) {
    if (!referencesPatient(encounter.subject, input.patientId) || !encounter.id) continue;
    const reference = `Encounter/${encounter.id}`;
    const text = conceptText([...(encounter.reasonCode ?? []), ...(encounter.type ?? [])]);
    const label = encounter.type?.[0]?.text ?? encounter.reasonCode?.[0]?.text ?? "Encounter";
    if (encounter.class?.code === "IMP") {
      push(encounter.period?.start, "admission", EXACERBATION_PATTERN.test(text) ? "Hospital admission for COPD exacerbation" : "Hospital admission", reference, label);
      push(encounter.period?.end, "discharge", "Hospital discharge", reference, label);
    } else if (encounter.class?.code === "HH") {
      push(encounter.period?.start ?? encounter.period?.end, "home-health", label || "Home-health visit", reference);
    } else if (encounter.class?.code === "AMB" && encounter.status === "finished") {
      push(encounter.period?.start, "ambulatory", label || "Ambulatory visit", reference);
    }
  }

  for (const condition of input.conditions ?? []) {
    if (!referencesPatient(condition.subject, input.patientId) || !condition.id) continue;
    if (!EXACERBATION_PATTERN.test(conceptText([condition.code]))) continue;
    push(condition.onsetDateTime ?? condition.recordedDate, "exacerbation", condition.code?.text ?? "COPD exacerbation", `Condition/${condition.id}`, condition.severity?.text);
  }

  for (const issue of input.detectedIssues ?? []) {
    if (!referencesPatient(issue.patient, input.patientId) || !issue.id) continue;
    push(issue.identifiedDateTime, "finding", issue.code?.text ?? "Decision-support finding", `DetectedIssue/${issue.id}`);
  }

  for (const task of input.tasks ?? []) {
    if (!referencesPatient(task.for, input.patientId) || !task.id) continue;
    push(task.authoredOn, "task", task.description ?? "Clinician review requested", `Task/${task.id}`, task.status);
  }

  for (const request of input.serviceRequests ?? []) {
    if (!referencesPatient(request.subject, input.patientId) || !request.id) continue;
    push(request.authoredOn, "referral", request.code?.text ?? "Referral", `ServiceRequest/${request.id}`, request.status);
  }

  for (const response of input.questionnaireResponses ?? []) {
    if (!referencesPatient(response.subject, input.patientId) || !response.id) continue;
    if (response.questionnaire !== COPD_HOME_HEALTH_QUESTIONNAIRE) continue;
    push(response.authored, "home-health", "Home-health respiratory assessment documented", `QuestionnaireResponse/${response.id}`, response.author?.display);
  }

  const deduped = new Map(events.map(event => [`${event.date}|${event.kind}|${event.label}`, event]));
  return [...deduped.values()].sort((a, b) => b.date.localeCompare(a.date) || a.label.localeCompare(b.label));
}
