/**
 * SYNTHETIC DEMO DATA. Seeds the longitudinal respiratory measurements the Respiratory Trends page
 * charts for the primary COPD demo patient.
 *
 * Only the gaps are filled: Maria already has a Sep 3–5 hospitalization, home-health encounters on
 * Sep 7 and Sep 8, SpO2/respiratory-rate/mMRC observations on Sep 7, and the Sep 8 home-health
 * QuestionnaireResponse. Every resource uses a stable id and a PUT so re-running is idempotent.
 */
import { getFhirConfig } from "../src/lib/fhir-config.js";
import { executeFhirTransaction } from "../src/lib/fhir-server-client.js";
import { COPD_DEMO_SYSTEM } from "../src/lib/copd-cds.js";

const patientId = "wp-copd-maria-pt-identity";
const hospitalizationEncounterId = "wp-copd-maria-enc-copd-hospitalization";
const sep6EncounterId = "wp-copd-maria-hh-sep6";
const sep7EncounterId = "wp-copd-maria-enc-home-health-visit";
const sep8EncounterId = "wp-copd-maria-hh-sep8";
const identifierSystem = "https://waypoint.example/fhir/identifier/respiratory-trend";
const LOINC = "http://loinc.org";
const homeHealthRn = { display: "Waypoint Home Health RN" };

interface Reading {
  key: string;
  date: string;
  encounterId: string;
  performer?: fhir4.Reference;
  system: string;
  code: string;
  display: string;
  value: number;
  unit?: string;
  ucum?: string;
  integer?: boolean;
}

/** SpO2, respiratory rate and mMRC on Sep 7 and Sep 8 already exist and are deliberately not re-stated here. */
const readings: Reading[] = [
  // Discharge day, recorded during the inpatient stay.
  { key: "spo2-sep5", date: "2026-09-05", encounterId: hospitalizationEncounterId, system: LOINC, code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry", value: 95, unit: "%", ucum: "%" },
  { key: "rr-sep5", date: "2026-09-05", encounterId: hospitalizationEncounterId, system: LOINC, code: "9279-1", display: "Respiratory rate", value: 18, unit: "breaths/min", ucum: "/min" },
  { key: "mmrc-sep5", date: "2026-09-05", encounterId: hospitalizationEncounterId, system: COPD_DEMO_SYSTEM, code: "mmrc-dyspnea", display: "mMRC dyspnea grade", value: 1, integer: true },
  { key: "rescue-sep5", date: "2026-09-05", encounterId: hospitalizationEncounterId, system: COPD_DEMO_SYSTEM, code: "rescue-inhaler-uses-per-day", display: "Reported rescue inhaler uses per day", value: 1, unit: "uses/day", ucum: "/d" },

  // First post-discharge home-health visit.
  { key: "spo2-sep6", date: "2026-09-06", encounterId: sep6EncounterId, performer: homeHealthRn, system: LOINC, code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry", value: 93, unit: "%", ucum: "%" },
  { key: "rr-sep6", date: "2026-09-06", encounterId: sep6EncounterId, performer: homeHealthRn, system: LOINC, code: "9279-1", display: "Respiratory rate", value: 20, unit: "breaths/min", ucum: "/min" },
  { key: "mmrc-sep6", date: "2026-09-06", encounterId: sep6EncounterId, performer: homeHealthRn, system: COPD_DEMO_SYSTEM, code: "mmrc-dyspnea", display: "mMRC dyspnea grade", value: 2, integer: true },
  { key: "rescue-sep6", date: "2026-09-06", encounterId: sep6EncounterId, performer: homeHealthRn, system: COPD_DEMO_SYSTEM, code: "rescue-inhaler-uses-per-day", display: "Reported rescue inhaler uses per day", value: 3, unit: "uses/day", ucum: "/d" },

  // Rescue-inhaler counts for the two visits that already carry the other measurements.
  { key: "rescue-sep7", date: "2026-09-07", encounterId: sep7EncounterId, performer: homeHealthRn, system: COPD_DEMO_SYSTEM, code: "rescue-inhaler-uses-per-day", display: "Reported rescue inhaler uses per day", value: 4, unit: "uses/day", ucum: "/d" },
  { key: "rescue-sep8", date: "2026-09-08", encounterId: sep8EncounterId, performer: homeHealthRn, system: COPD_DEMO_SYSTEM, code: "rescue-inhaler-uses-per-day", display: "Reported rescue inhaler uses per day", value: 5, unit: "uses/day", ucum: "/d" },
];

function observation(reading: Reading): fhir4.Observation {
  const value: Partial<fhir4.Observation> = reading.integer
    ? { valueInteger: reading.value }
    : { valueQuantity: { value: reading.value, unit: reading.unit, system: "http://unitsofmeasure.org", code: reading.ucum } };
  return {
    resourceType: "Observation",
    id: `wp-copd-maria-trend-${reading.key}`,
    identifier: [{ system: identifierSystem, value: reading.key }],
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
    code: { coding: [{ system: reading.system, code: reading.code, display: reading.display }], text: reading.display },
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${reading.encounterId}` },
    effectiveDateTime: reading.date,
    ...(reading.performer ? { performer: [reading.performer] } : {}),
    ...value,
  };
}

const sep6Encounter: fhir4.Encounter = {
  resourceType: "Encounter",
  id: sep6EncounterId,
  identifier: [{ system: identifierSystem, value: "maria-home-health-sep6" }],
  status: "finished",
  class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "HH", display: "Home health encounter" },
  type: [{ text: "Post-discharge COPD home-health visit" }],
  subject: { reference: `Patient/${patientId}` },
  period: { start: "2026-09-06T10:00:00-07:00", end: "2026-09-06T10:45:00-07:00" },
};

function entry(resource: fhir4.Resource): fhir4.BundleEntry {
  return { fullUrl: `urn:uuid:${resource.resourceType}-${resource.id}`, resource, request: { method: "PUT", url: `${resource.resourceType}/${resource.id}` } };
}

export async function seedCopdRespiratoryTrends() {
  const resources: fhir4.Resource[] = [sep6Encounter, ...readings.map(observation)];
  const result = await executeFhirTransaction<fhir4.Bundle | fhir4.OperationOutcome>({ resourceType: "Bundle", type: "transaction", entry: resources.map(entry) });
  if (result.status !== 200 || result.body.resourceType !== "Bundle") throw new Error(`Respiratory trend seed failed (${result.status}).`);
  console.log(JSON.stringify({ fhirTarget: getFhirConfig().baseUrl, patientId, encounters: [sep6EncounterId], observations: readings.length, dataKind: "synthetic demo" }, null, 2));
}

if (import.meta.main) seedCopdRespiratoryTrends().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
