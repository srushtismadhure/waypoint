import { describe, expect, test } from "bun:test";
import { COPD_CDS_SYSTEM, COPD_FINDING_SYSTEM, copdCards, evaluateCopd, prioritizedFindings } from "./copd-cds";
import type { CopdInput } from "./copd-cds";
import { findingTransaction } from "./copd-cds-service";

export const NOW = "2026-09-09T12:00:00Z";
export function fixture(patientId = "patient-a"): CopdInput {
  return { patientId, now: NOW, resources: [{ resourceType: "Condition", id: "copd", subject: { reference: `Patient/${patientId}` }, code: { coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "J44.9" }] } } as fhir4.Condition], complete: Object.fromEntries(["Condition", "Encounter", "MedicationRequest", "MedicationStatement", "DetectedIssue", "Task", "Observation", "QuestionnaireResponse", "Appointment", "ServiceRequest", "CarePlan"].map(type => [type, true])), config: { schedulingAuthoritative: true, rehabilitationAuthoritative: true, oxygenAuthoritative: true } };
}
export function medicationEvidence(patientId = "patient-a"): fhir4.Resource[] {
  return [
    { resourceType: "MedicationRequest", id: "tiotropium", status: "active", intent: "order", subject: { reference: `Patient/${patientId}` }, medicationCodeableConcept: { text: "Tiotropium" }, dosageInstruction: [{ text: "Once daily", timing: { repeat: { frequency: 1, period: 1, periodUnit: "d" } } }] } as fhir4.MedicationRequest,
    { resourceType: "MedicationStatement", id: "reported-use", status: "not-taken", subject: { reference: `Patient/${patientId}` }, medicationCodeableConcept: { text: "Tiotropium" }, basedOn: [{ reference: "MedicationRequest/tiotropium" }], informationSource: { display: "Home health nurse" }, dateAsserted: "2026-09-08T12:00:00Z", note: [{ text: "Patient reports not taking for seven days because medication ran out." }] } as fhir4.MedicationStatement,
  ];
}
export function hospitalization(patientId = "patient-a"): fhir4.Encounter {
  return { resourceType: "Encounter", id: "copd-discharge", subject: { reference: `Patient/${patientId}` }, status: "finished", class: { code: "IMP" }, reasonCode: [{ coding: [{ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "J44.1" }] }], period: { start: "2026-08-28T12:00:00Z", end: "2026-09-01T12:00:00Z" } };
}
function signal(code: string, value = true): fhir4.Observation {
  return { resourceType: "Observation", id: code, subject: { reference: "Patient/patient-a" }, status: "final", code: { coding: [{ system: COPD_CDS_SYSTEM, code }] }, valueBoolean: value, effectiveDateTime: "2026-09-08T12:00:00Z" };
}
describe("shared deterministic COPD rules", () => {
  test("A: confirmed interruption produces one explainable finding without modifying the order", () => {
    const input = fixture(); input.resources.push(...medicationEvidence());
    const snapshot = JSON.stringify(input);
    const findings = evaluateCopd(input).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe("MEDICATION_RECONCILIATION");
    expect(findings[0]!.explanation).toContain("ran out");
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  test("confirmed structured dose/frequency mismatch fires; equivalent text is not guessed", () => {
    const input = fixture(); const [order, raw] = medicationEvidence();
    const statement = { ...raw, status: "active", dosage: [{ timing: { repeat: { frequency: 2, period: 1, periodUnit: "d" } } }] } as fhir4.MedicationStatement;
    input.resources.push(order!, statement);
    expect(evaluateCopd(input).findings).toHaveLength(1);
    statement.dosage = [{ text: "Take daily" }];
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("confirmed home medication missing from a complete prescription list fires", () => {
    const input = fixture(); const statement = { ...medicationEvidence()[1], status: "active" } as fhir4.MedicationStatement;
    input.resources.push(statement);
    expect(evaluateCopd(input).findings[0]!.ruleId).toBe("unlisted-home-medication");
    input.complete.MedicationRequest = false;
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("newer confirmed reconciliation supersedes the old discrepancy", () => {
    const input = fixture(); input.resources.push(...medicationEvidence(), { ...medicationEvidence()[1], id: "new-report", status: "active", dateAsserted: NOW } as fhir4.MedicationStatement);
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("unconfirmed AI candidates do not produce findings", () => {
    const input = fixture(); const statement = medicationEvidence()[1] as fhir4.MedicationStatement;
    statement.meta = { tag: [{ code: "candidate" }] };
    input.resources.push(medicationEvidence()[0]!, statement, { ...signal("increased-rescue-use"), status: "preliminary" } as fhir4.Observation, hospitalization());
    input.config = { rehabReviewEnabled: false };
    input.complete.Appointment = false;
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("B: exacerbation plus confirmed worsening signals fires, without probability", () => {
    const input = fixture(); input.resources.push(hospitalization(), signal("increased-rescue-use"), signal("worsening-dyspnea"));
    const result = evaluateCopd(input);
    expect(result.findings.some(finding => finding.category === "WORSENING_COPD_PATTERN")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/\d+%|probability|will be hospitalized/i);
    expect(result.context.exacerbationsLastYear).toBe(1);
  });
  test("an isolated low SpO2 or symptom does not establish worsening COPD", () => {
    const input = fixture(); input.resources.push(signal("worsening-dyspnea"), { ...signal("spo2"), valueBoolean: undefined, code: { coding: [{ system: "http://loinc.org", code: "59408-5" }] }, valueQuantity: { value: 85, unit: "%" } } as fhir4.Observation);
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("negative latest signal suppresses a prior positive signal", () => {
    const input = fixture(); input.resources.push(hospitalization(), signal("increased-rescue-use"), { ...signal("increased-rescue-use", false), id: "latest", effectiveDateTime: NOW } as fhir4.Observation);
    expect(evaluateCopd(input).findings.some(finding => finding.category === "WORSENING_COPD_PATTERN")).toBe(false);
  });
  test("C: follow-up gap requires complete, authoritative scheduling", () => {
    const input = fixture(); input.resources.push(hospitalization());
    expect(evaluateCopd(input).findings.some(finding => finding.category === "POST_DISCHARGE_FOLLOWUP")).toBe(true);
    input.complete.Appointment = false;
    const result = evaluateCopd(input);
    expect(result.findings.some(finding => finding.category === "POST_DISCHARGE_FOLLOWUP")).toBe(false);
    expect(result.insufficientData.join(" ")).toContain("Scheduling");
    input.complete.Appointment = true; input.config!.schedulingAuthoritative = false;
    expect(evaluateCopd(input).findings.some(finding => finding.category === "POST_DISCHARGE_FOLLOWUP")).toBe(false);
  });
  test("appropriate booked follow-up in the early window suppresses the gap", () => {
    const input = fixture(); input.resources.push(hospitalization(), { resourceType: "Appointment", id: "followup", status: "booked", participant: [{ actor: { reference: "Patient/patient-a" }, status: "accepted" }], start: "2026-09-15T12:00:00Z", serviceType: [{ coding: [{ system: COPD_CDS_SYSTEM, code: "copd-follow-up" }] }] } as fhir4.Appointment);
    expect(evaluateCopd(input).findings.some(finding => finding.category === "POST_DISCHARGE_FOLLOWUP")).toBe(false);
  });
  test("D: documented rehabilitation suppresses the gap; incomplete records never prove absence", () => {
    const input = fixture(); input.resources.push(hospitalization());
    expect(evaluateCopd(input).findings.some(finding => finding.category === "PULMONARY_REHAB_GAP")).toBe(true);
    input.resources.push({ resourceType: "ServiceRequest", id: "rehab", status: "active", intent: "order", subject: { reference: "Patient/patient-a" }, code: { coding: [{ system: COPD_CDS_SYSTEM, code: "pulmonary-rehabilitation" }] } } as fhir4.ServiceRequest);
    expect(evaluateCopd(input).findings.some(finding => finding.category === "PULMONARY_REHAB_GAP")).toBe(false);
    input.resources.pop(); input.complete.ServiceRequest = false;
    expect(evaluateCopd(input).findings.some(finding => finding.category === "PULMONARY_REHAB_GAP")).toBe(false);
  });
  test("oxygen reassessment requires an explicitly due task and documented oxygen", () => {
    const input = fixture(); input.resources.push(hospitalization(), signal("oxygen-use"));
    expect(evaluateCopd(input).findings.some(finding => finding.category === "OXYGEN_REASSESSMENT")).toBe(false);
    input.resources.push({ resourceType: "Task", id: "oxygen-review", status: "requested", intent: "order", for: { reference: "Patient/patient-a" }, code: { coding: [{ system: COPD_CDS_SYSTEM, code: "oxygen-reassessment" }] }, executionPeriod: { end: "2026-09-05T12:00:00Z" } } as fhir4.Task);
    expect(evaluateCopd(input).findings.some(finding => finding.category === "OXYGEN_REASSESSMENT")).toBe(true);
    input.resources.push(signal("oxygen-reassessment"));
    expect(evaluateCopd(input).findings.some(finding => finding.category === "OXYGEN_REASSESSMENT")).toBe(false);
  });
  test("E: stable COPD returns exactly no cards", () => {
    expect(copdCards(evaluateCopd(fixture()), "https://waypoint.example")).toEqual([]);
  });
  test("F: another patient's resources never enter the result", () => {
    const input = fixture("harold"); input.resources.push(...medicationEvidence("maria"), hospitalization("maria"), signal("increased-rescue-use"));
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("final issue alone does not mean resolved; recorded mitigation suppresses exact evidence", () => {
    const input = fixture(); input.resources.push(...medicationEvidence());
    const finding = evaluateCopd(input).findings[0]!;
    const issue: fhir4.DetectedIssue = { resourceType: "DetectedIssue", id: "issue", patient: { reference: "Patient/patient-a" }, status: "final", identifier: [{ system: COPD_FINDING_SYSTEM, value: finding.id }] };
    input.resources.push(issue);
    expect(evaluateCopd(input).findings).toHaveLength(1);
    issue.mitigation = [{ action: { text: "Reviewed with patient" } }];
    expect(evaluateCopd(input).findings).toHaveLength(0);
    input.resources.push({ ...medicationEvidence()[1], id: "new-interruption", dateAsserted: NOW } as fhir4.MedicationStatement);
    expect(evaluateCopd(input).findings).toHaveLength(1);
  });
  test("repeated evaluations have deterministic identities and conditional-create transactions", () => {
    const input = fixture(); input.resources.push(...medicationEvidence());
    const a = evaluateCopd(input); const b = evaluateCopd(input);
    expect(a).toEqual(b);
    const transaction = findingTransaction(a.findings, NOW);
    expect(transaction.entry).toHaveLength(2);
    expect(transaction.entry!.every(entry => entry.request?.ifNoneExist?.includes(encodeURIComponent(a.findings[0]!.id)))).toBe(true);
    expect(transaction.entry!.map(entry => entry.resource?.resourceType)).toEqual(["DetectedIssue", "Task"]);
  });
  test("care transition cards aggregate; links preserve the actual patient and SMART context", () => {
    const input = fixture(); input.resources.push(hospitalization(), ...medicationEvidence());
    const result = evaluateCopd(input);
    expect(prioritizedFindings(result.findings).some(finding => finding.category === "CARE_TRANSITION_GAP")).toBe(true);
    const cards = copdCards(result, "https://waypoint.example");
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(cards.every(card => card.links[0]!.url.includes("/patients/patient-a"))).toBe(true);
    const smart = copdCards(result, "https://waypoint.example", "https://app.medblocks.com/launch");
    expect(smart[0]!.links[0]!.type).toBe("smart");
    expect(JSON.parse(smart[0]!.links[0]!.appContext!).patientId).toBe("patient-a");
  });
  test("old/future exacerbations do not fire a current transition alert", () => {
    for (const date of ["2024-01-01", "2028-01-01"]) {
      const input = fixture(); input.resources.push({ ...hospitalization(), period: { end: date } } as fhir4.Encounter);
      expect(evaluateCopd(input).findings).toHaveLength(0);
    }
  });
});
