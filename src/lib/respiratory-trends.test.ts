import { describe, expect, test } from "bun:test";
import { COPD_DEMO_SYSTEM, COPD_HOME_HEALTH_QUESTIONNAIRE } from "./copd-cds";
import { buildClinicalEvents, buildRespiratorySeries, computeTrajectory, latestObservationPoint, parseLeadingNumber, RESPIRATORY_METRICS } from "./respiratory-trends";

const PATIENT = "wp-copd-maria-pt-identity";
const LOINC = "http://loinc.org";

function observation(code: string, system: string, date: string, value: number, options: { patientId?: string; encounter?: string; performer?: string; status?: fhir4.Observation["status"] } = {}): fhir4.Observation {
  return {
    resourceType: "Observation",
    id: `${code}-${date}`,
    status: options.status ?? "final",
    code: { coding: [{ system, code }] },
    subject: { reference: `Patient/${options.patientId ?? PATIENT}` },
    effectiveDateTime: date,
    valueQuantity: { value },
    ...(options.encounter ? { encounter: { reference: `Encounter/${options.encounter}` } } : {}),
    ...(options.performer ? { performer: [{ display: options.performer }] } : {}),
  };
}
function encounter(id: string, cls: string, start: string, end?: string, patientId = PATIENT): fhir4.Encounter {
  return { resourceType: "Encounter", id, status: "finished", class: { code: cls }, subject: { reference: `Patient/${patientId}` }, period: { start, ...(end ? { end } : {}) } };
}
function homeHealthResponse(date: string, items: Record<string, string>, patientId = PATIENT): fhir4.QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    id: `qr-${date}`,
    questionnaire: COPD_HOME_HEALTH_QUESTIONNAIRE,
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: "Encounter/hh-visit" },
    authored: `${date}T11:00:00Z`,
    author: { display: "Waypoint Home Health RN" },
    item: Object.entries(items).map(([linkId, value]) => ({ linkId, answer: [{ valueString: value }] })),
  };
}
const spo2 = (date: string, value: number, options?: Parameters<typeof observation>[4]) => observation("59408-5", LOINC, date, value, options);
const respiratoryRate = (date: string, value: number, options?: Parameters<typeof observation>[4]) => observation("9279-1", LOINC, date, value, options);
const rescue = (date: string, value: number) => observation("rescue-inhaler-uses-per-day", COPD_DEMO_SYSTEM, date, value);
const seriesFor = (key: string, series: ReturnType<typeof buildRespiratorySeries>) => series.find(item => item.definition.key === key)!;

describe("parseLeadingNumber", () => {
  test("reads a leading measurement and rejects non-numeric answers", () => {
    expect(parseLeadingNumber("90 %")).toBe(90);
    expect(parseLeadingNumber("22 breaths/min")).toBe(22);
    expect(parseLeadingNumber("3")).toBe(3);
    for (const text of ["Worse", "Not scheduled", "", undefined]) expect(parseLeadingNumber(text)).toBeUndefined();
  });
});

describe("buildRespiratorySeries", () => {
  test("builds one chronological series per configured metric", () => {
    const series = buildRespiratorySeries(PATIENT, [spo2("2026-09-06", 93), spo2("2026-09-05", 95)]);
    expect(series.map(item => item.definition.key)).toEqual(RESPIRATORY_METRICS.map(metric => metric.key));
    expect(seriesFor("spo2", series).points.map(point => [point.date, point.value])).toEqual([["2026-09-05", 95], ["2026-09-06", 93]]);
  });

  test("another patient's observations and questionnaire responses never enter the series", () => {
    const series = buildRespiratorySeries(PATIENT, [spo2("2026-09-05", 95, { patientId: "someone-else" })], [homeHealthResponse("2026-09-08", { spo2: "90 %" }, "someone-else")]);
    expect(seriesFor("spo2", series).points).toEqual([]);
  });

  test("labels the source from the encounter class, and falls back to the performer", () => {
    const encounters = [encounter("hosp", "IMP", "2026-09-03", "2026-09-05"), encounter("hh", "HH", "2026-09-06"), encounter("clinic", "AMB", "2026-09-07")];
    const series = buildRespiratorySeries(
      PATIENT,
      [
        spo2("2026-09-05", 95, { encounter: "hosp" }),
        spo2("2026-09-06", 93, { encounter: "hh" }),
        spo2("2026-09-07", 92, { encounter: "clinic" }),
        spo2("2026-09-09", 90, { performer: "Waypoint Home Health RN" }),
        spo2("2026-09-10", 90),
      ],
      [],
      encounters,
    );
    expect(seriesFor("spo2", series).points.map(point => point.sourceLabel)).toEqual(["Hospital", "Home Health RN", "Ambulatory", "Home Health RN", "Clinical record"]);
  });

  test("home-health questionnaire answers become points and a confirmed observation supersedes them", () => {
    const response = homeHealthResponse("2026-09-08", { spo2: "90 %", "respiratory-rate": "22 breaths/min", mmrc: "3", "breathing-baseline": "Worse" });
    const fromQuestionnaire = buildRespiratorySeries(PATIENT, [], [response]);
    expect(seriesFor("spo2", fromQuestionnaire).points).toEqual([{ date: "2026-09-08", value: 90, source: "home-health", sourceLabel: "Home Health RN", resource: "QuestionnaireResponse/qr-2026-09-08" }]);
    expect(seriesFor("mmrc", fromQuestionnaire).points[0]!.value).toBe(3);

    const withObservation = buildRespiratorySeries(PATIENT, [spo2("2026-09-08", 91)], [response]);
    const point = seriesFor("spo2", withObservation).points[0]!;
    expect(point.value).toBe(91);
    expect(point.resource).toBe("Observation/59408-5-2026-09-08");
  });

  test("unfinalized observations and non-numeric answers are ignored", () => {
    const series = buildRespiratorySeries(PATIENT, [spo2("2026-09-05", 95, { status: "preliminary" })], [homeHealthResponse("2026-09-08", { spo2: "Not recorded" })]);
    expect(seriesFor("spo2", series).points).toEqual([]);
  });
});

describe("computeTrajectory", () => {
  const decline = [spo2("2026-09-05", 95), spo2("2026-09-06", 93), spo2("2026-09-08", 90)];

  test("declining oxygen saturation and rising rescue use read as worsening, with explanations", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, [...decline, rescue("2026-09-05", 1), rescue("2026-09-08", 5)]));
    expect(summary.trajectory).toBe("worsening");
    expect(summary.signals.map(signal => signal.metric).sort()).toEqual(["rescueUse", "spo2"]);
    expect(summary.signals.every(signal => signal.direction === "worsening")).toBe(true);
    expect(summary.signals.find(signal => signal.metric === "spo2")!.description).toContain("95 → 90");
  });

  test("the reverse direction reads as improving", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, [spo2("2026-09-05", 90), spo2("2026-09-08", 95)]));
    expect(summary.trajectory).toBe("improving");
    expect(summary.signals[0]!.direction).toBe("improving");
  });

  test("a single measurement is never a trend", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, [spo2("2026-09-08", 88)]));
    expect(summary.trajectory).toBe("insufficient-data");
    expect(summary.signals).toEqual([]);
    expect(summary.comparedMetrics).toBe(0);
  });

  test("no measurements at all report insufficient data rather than stable", () => {
    expect(computeTrajectory(buildRespiratorySeries(PATIENT, [])).trajectory).toBe("insufficient-data");
  });

  test("a change below the configured threshold stays stable", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, [spo2("2026-09-05", 95), spo2("2026-09-08", 94)]));
    expect(summary.trajectory).toBe("stable");
    expect(summary.signals).toEqual([]);
    expect(summary.comparedMetrics).toBe(1);
  });

  test("conflicting directions are not reported as a single trajectory claim", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, [...decline, respiratoryRate("2026-09-05", 24), respiratoryRate("2026-09-08", 18)]));
    expect(summary.trajectory).toBe("stable");
    expect(summary.signals.map(signal => signal.direction).sort()).toEqual(["improving", "worsening"]);
  });

  test("nothing in the summary implies a probability or predicted acute-care visit", () => {
    const summary = computeTrajectory(buildRespiratorySeries(PATIENT, decline));
    expect(JSON.stringify(summary)).not.toMatch(/%\s*risk|probability|predict|emergency department|ED visit/i);
  });
});

describe("latestObservationPoint", () => {
  test("returns the most recent measurement across every metric", () => {
    const point = latestObservationPoint(buildRespiratorySeries(PATIENT, [spo2("2026-09-05", 95), rescue("2026-09-08", 5)]));
    expect(point?.date).toBe("2026-09-08");
    expect(point?.value).toBe(5);
  });
});

describe("buildClinicalEvents", () => {
  test("summarizes admissions, discharges, visits, findings, tasks and referrals once each", () => {
    const events = buildClinicalEvents({
      patientId: PATIENT,
      encounters: [{ ...encounter("hosp", "IMP", "2026-09-03", "2026-09-05"), reasonCode: [{ text: "COPD exacerbation" }] }, encounter("hh", "HH", "2026-09-06")],
      detectedIssues: [{ resourceType: "DetectedIssue", id: "issue", status: "preliminary", patient: { reference: `Patient/${PATIENT}` }, code: { text: "COPD medication discrepancy requires review" }, identifiedDateTime: "2026-09-08T09:00:00Z" }],
      tasks: [{ resourceType: "Task", id: "task", status: "requested", intent: "order", for: { reference: `Patient/${PATIENT}` }, description: "Clinician review requested", authoredOn: "2026-09-09T09:00:00Z" }],
      serviceRequests: [{ resourceType: "ServiceRequest", id: "rehab", status: "active", intent: "order", subject: { reference: `Patient/${PATIENT}` }, code: { text: "Pulmonary rehabilitation referral" }, authoredOn: "2026-09-09T10:00:00Z" }],
    });
    expect(events.map(event => `${event.date} ${event.kind}`)).toEqual([
      "2026-09-09 task",
      "2026-09-09 referral",
      "2026-09-08 finding",
      "2026-09-06 home-health",
      "2026-09-05 discharge",
      "2026-09-03 admission",
    ]);
    expect(events.find(event => event.kind === "admission")!.label).toContain("COPD exacerbation");
  });

  test("another patient's events are excluded and individual measurements are never listed", () => {
    const events = buildClinicalEvents({
      patientId: PATIENT,
      encounters: [encounter("other", "IMP", "2026-09-03", "2026-09-05", "someone-else")],
      tasks: [{ resourceType: "Task", id: "task", status: "requested", intent: "order", for: { reference: "Patient/someone-else" }, description: "Other patient task", authoredOn: "2026-09-09" }],
    });
    expect(events).toEqual([]);
  });

  test("carries no lupus or renal terminology", () => {
    const events = buildClinicalEvents({ patientId: PATIENT, encounters: [encounter("hh", "HH", "2026-09-06")] });
    expect(JSON.stringify(events)).not.toMatch(/lupus|nephritis|\bSLE\b|LuppedIn|UPCR|eGFR|nephrology|renal|kidney/i);
  });
});
