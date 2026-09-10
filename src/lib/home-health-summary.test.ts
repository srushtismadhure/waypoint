import { describe, expect, test } from "bun:test";
import { COPD_HOME_HEALTH_QUESTIONNAIRE } from "./copd-cds";
import { buildHomeHealthSummary, buildRehabSummary, CLINICAL_NOTE_TYPE_CODE } from "./home-health-summary";

const PATIENT = "wp-copd-maria-pt-identity";

function encounter(id: string, cls: string, start: string, end: string, patientId = PATIENT, extra: Partial<fhir4.Encounter> = {}): fhir4.Encounter {
  return { resourceType: "Encounter", id, status: "finished", class: { code: cls }, subject: { reference: `Patient/${patientId}` }, period: { start, end }, ...extra };
}
function response(id: string, questionnaire: string, authored: string, items: Record<string, string>, encounterId = "hh-sep8", patientId = PATIENT): fhir4.QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    id,
    questionnaire,
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored,
    author: { display: "Waypoint Home Health RN" },
    item: Object.entries(items).map(([linkId, value]) => ({ linkId, answer: [{ valueString: value }] })),
  };
}
function finalNote(patientId = PATIENT): fhir4.DocumentReference {
  return {
    resourceType: "DocumentReference",
    id: "note-1",
    status: "current",
    docStatus: "final",
    subject: { reference: `Patient/${patientId}` },
    date: "2026-09-08T12:00:00Z",
    type: { coding: [{ code: CLINICAL_NOTE_TYPE_CODE }], text: "Home Health Nursing Visit Note" },
    author: [{ display: "Waypoint Home Health RN" }],
    content: [{ attachment: { contentType: "application/json", title: "Clinical note payload" } }],
  };
}

const visitEncounter = encounter("hh-sep8", "HH", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", PATIENT, { type: [{ text: "Start of Care" }] });
const hospitalization = encounter("hosp", "IMP", "2026-09-03T16:00:00Z", "2026-09-05T13:00:00Z");
const copdAnswers = { spo2: "90 %", "respiratory-rate": "22 breaths/min", mmrc: "3", "oxygen-use": "Nocturnal", rehab: "Not documented" };

describe("buildHomeHealthSummary", () => {
  test("summarizes the latest completed visit with post-discharge day", () => {
    const summary = buildHomeHealthSummary({ patientId: PATIENT, encounters: [visitEncounter, hospitalization] });
    expect(summary.visit).toMatchObject({ encounterId: "hh-sep8", date: "2026-09-08", status: "finished", clinician: "Home Health RN", postDischargeDay: 3 });
  });

  test("reports assessment completion and a finalized note without exposing note content", () => {
    const summary = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [visitEncounter],
      questionnaireResponses: [response("copd", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-08T11:10:00Z", copdAnswers), response("oasis", "https://waypoint.example/fhir/Questionnaire/oasis-e2-demo-subset", "2026-09-08T11:15:00Z", { M1033: "1" })],
      documentReferences: [finalNote()],
    });
    expect(summary.assessments.map(item => [item.label, item.state])).toEqual([
      ["COPD assessment", "completed"],
      ["OASIS-E2", "completed"],
      ["Clinical note", "completed"],
    ]);
    expect(summary.finalizedNote).toMatchObject({ id: "note-1", title: "Home Health Nursing Visit Note" });
  });

  test("a preliminary note is not reported as finalized", () => {
    const summary = buildHomeHealthSummary({ patientId: PATIENT, encounters: [visitEncounter], documentReferences: [{ ...finalNote(), docStatus: "preliminary" }] });
    expect(summary.finalizedNote).toBeUndefined();
    expect(summary.assessments.find(item => item.label === "Clinical note")!.state).toBe("not-started");
  });

  test("surfaces clinician-relevant confirmed answers only", () => {
    const summary = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [visitEncounter],
      questionnaireResponses: [response("copd", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-08T11:10:00Z", { ...copdAnswers, "inhaler-technique": "Adequate" })],
    });
    expect(summary.findings.map(finding => finding.label)).toEqual(["SpO2", "Respiratory rate", "Dyspnea (mMRC)", "Oxygen use", "Pulmonary rehabilitation"]);
    expect(summary.findings.every(finding => finding.source === "Waypoint Home Health RN")).toBe(true);
  });

  test("answers from a different visit never appear under the latest visit", () => {
    const summary = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [visitEncounter, encounter("hh-sep6", "HH", "2026-09-06T10:00:00Z", "2026-09-06T11:00:00Z")],
      questionnaireResponses: [response("older", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-06T11:10:00Z", { spo2: "93 %" }, "hh-sep6")],
    });
    expect(summary.visit?.encounterId).toBe("hh-sep8");
    expect(summary.findings).toEqual([]);
  });

  test("another patient's visit is never summarized", () => {
    const summary = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [encounter("other", "HH", "2026-09-08T10:00:00Z", "2026-09-08T11:00:00Z", "someone-else")],
      questionnaireResponses: [response("copd", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-08T11:10:00Z", copdAnswers, "other", "someone-else")],
      documentReferences: [finalNote("someone-else")],
    });
    expect(summary.visit).toBeUndefined();
    expect(summary.findings).toEqual([]);
    expect(summary.finalizedNote).toBeUndefined();
  });

  test("no completed visit yields an empty summary rather than a fabricated one", () => {
    const summary = buildHomeHealthSummary({ patientId: PATIENT, encounters: [{ ...visitEncounter, status: "in-progress" }] });
    expect(summary.visit).toBeUndefined();
    expect(summary.assessments.every(item => item.state === "not-started")).toBe(true);
  });

  test("nurse recording chain: confirmed answers reach the clinician summary once the visit encounter is linked", () => {
    const recorded = { spo2: "89 %", "breathing-baseline": "Worse", "rescue-inhaler": "Increased" };
    // The nurse page used to write Encounter/<patientId>, which matches no encounter and hid the whole assessment.
    const danglingEncounter = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [visitEncounter],
      questionnaireResponses: [response("copd", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-08T11:10:00Z", recorded, PATIENT)],
    });
    expect(danglingEncounter.findings).toEqual([]);

    const linked = buildHomeHealthSummary({
      patientId: PATIENT,
      encounters: [visitEncounter],
      questionnaireResponses: [response("copd", COPD_HOME_HEALTH_QUESTIONNAIRE, "2026-09-08T11:10:00Z", recorded)],
    });
    expect(linked.assessments.find(item => item.label === "COPD assessment")!.state).toBe("completed");
    expect(linked.findings.map(finding => [finding.label, finding.value])).toEqual([
      ["SpO2", "89 %"],
      ["Breathing vs baseline", "Worse"],
      ["Rescue inhaler use", "Increased"],
    ]);
  });
});

describe("buildRehabSummary", () => {
  const referral = (status: fhir4.ServiceRequest["status"]): fhir4.ServiceRequest => ({
    resourceType: "ServiceRequest",
    id: "rehab",
    status,
    intent: "order",
    subject: { reference: `Patient/${PATIENT}` },
    code: { text: "Pulmonary rehabilitation referral" },
    authoredOn: "2026-09-06",
  });

  test("no documented indication reads as not referred", () => {
    expect(buildRehabSummary({ patientId: PATIENT }).status).toBe("not-referred");
  });

  test("a hospitalization or an open CDS gap recommends a referral without placing one", () => {
    const summary = buildRehabSummary({ patientId: PATIENT, encounters: [hospitalization], copdFindingRuleIds: ["pulmonary-rehab-gap"] });
    expect(summary.status).toBe("referral-recommended");
    expect(summary.rationale).toHaveLength(2);
    expect(summary.referenceResources).toEqual([]);
  });

  test("an active referral, booked intake and completed plan escalate the status", () => {
    expect(buildRehabSummary({ patientId: PATIENT, serviceRequests: [referral("active")] }).status).toBe("referral-placed");
    const scheduled = buildRehabSummary({
      patientId: PATIENT,
      serviceRequests: [referral("active")],
      appointments: [{ resourceType: "Appointment", id: "intake", status: "booked", start: "2026-09-20T15:00:00Z", participant: [{ actor: { reference: `Patient/${PATIENT}` }, status: "accepted" }], serviceType: [{ text: "Pulmonary rehabilitation" }] }],
    });
    expect(scheduled.status).toBe("intake-scheduled");
    expect(scheduled.nextAppointment).toBe("2026-09-20");
    expect(buildRehabSummary({ patientId: PATIENT, serviceRequests: [referral("completed")] }).status).toBe("completed");
  });

  test("another patient's referral is ignored", () => {
    const summary = buildRehabSummary({ patientId: PATIENT, serviceRequests: [{ ...referral("active"), subject: { reference: "Patient/someone-else" } }] });
    expect(summary.status).toBe("not-referred");
    expect(summary.referenceResources).toEqual([]);
  });

  test("uses pulmonary rehabilitation wording and no legacy terminology", () => {
    const summary = buildRehabSummary({ patientId: PATIENT, encounters: [hospitalization] });
    expect(JSON.stringify(summary)).not.toMatch(/physical rehab|lupus|renal|kidney/i);
    expect(summary.rationale.join(" ")).toContain("COPD hospitalization");
  });
});
