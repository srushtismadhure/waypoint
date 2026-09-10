import { describe, expect, test } from "bun:test";
import { CDS_SERVICES_DISCOVERY, COPD_PATIENT_VIEW_PREFETCH } from "./cds-hooks";
import { COPD_HOME_HEALTH_QUESTIONNAIRE, copdCards, evaluateCopd, prioritizedFindings } from "./copd-cds";
import { normalizePrefetch } from "./copd-cds-service";
import { fixture, hospitalization, medicationEvidence, NOW } from "./copd-cds.test";
import { handleCopdHook } from "../server/copd-cds-handlers";

const LEGACY_TERMS = /lupus|nephritis|\bSLE\b|LuppedIn|UPCR|eGFR|nephrology|renal|kidney/i;

function post(serviceId: string, body: unknown) {
  return new Request(`http://localhost/cds-services/${serviceId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function homeHealthResponse(authored: string, patientId = "patient-a"): fhir4.QuestionnaireResponse {
  return { resourceType: "QuestionnaireResponse", id: "hh-visit", questionnaire: COPD_HOME_HEALTH_QUESTIONNAIRE, status: "completed", subject: { reference: `Patient/${patientId}` }, authored, author: { display: "Home Health RN" }, item: [{ linkId: "breathing-baseline", answer: [{ valueString: "Worse" }] }] };
}
function rescueSignal(patientId = "patient-a"): fhir4.Observation {
  return { resourceType: "Observation", id: "rescue", subject: { reference: `Patient/${patientId}` }, status: "final", code: { coding: [{ system: "https://waypoint.example/fhir/CodeSystem/copd-cds", code: "increased-rescue-use" }] }, valueBoolean: true, effectiveDateTime: "2026-09-08T12:00:00Z" };
}

describe("CDS discovery", () => {
  test("advertises one service per supported hook with Waypoint COPD wording", () => {
    expect(CDS_SERVICES_DISCOVERY.services.map(service => service.hook)).toEqual(["patient-view", "order-select", "order-sign"]);
    expect(CDS_SERVICES_DISCOVERY.services.map(service => service.id)).toEqual(["waypoint-patient-view", "waypoint-order-select", "waypoint-order-sign"]);
    for (const service of CDS_SERVICES_DISCOVERY.services) {
      expect(service.title).toContain("Waypoint");
      expect(service.description.length).toBeGreaterThan(0);
    }
  });
  test("carries no legacy lupus or renal terminology", () => {
    expect(JSON.stringify(CDS_SERVICES_DISCOVERY)).not.toMatch(LEGACY_TERMS);
  });
  test("prefetch is targeted to context.patientId and only to resources the rules consume", () => {
    const templates = Object.values(COPD_PATIENT_VIEW_PREFETCH);
    expect(templates.every(template => template.includes("{{context.patientId}}"))).toBe(true);
    expect(templates.length).toBeLessThanOrEqual(10);
    expect(CDS_SERVICES_DISCOVERY.services[0]!.prefetch).toBe(COPD_PATIENT_VIEW_PREFETCH);
  });
});

describe("prefetch normalization", () => {
  const bundle = (entry: fhir4.BundleEntry[], extra: Partial<fhir4.Bundle> = {}): fhir4.Bundle => ({ resourceType: "Bundle", type: "searchset", entry, ...extra });
  const condition = { resourceType: "Condition", id: "copd", subject: { reference: "Patient/patient-a" } } as fhir4.Condition;

  test("a whole searchset is trusted and marks the resource type complete", () => {
    const { resources, complete } = normalizePrefetch({ conditions: bundle([{ resource: condition }], { total: 1 }) });
    expect(resources).toEqual([condition]);
    expect(complete.Condition).toBe(true);
  });
  test("a paged or truncated bundle never proves absence", () => {
    for (const partial of [bundle([{ resource: condition }], { link: [{ relation: "next", url: "https://example/next" }] }), bundle([{ resource: condition }], { total: 9 })]) {
      const { resources, complete } = normalizePrefetch({ conditions: partial });
      expect(resources).toEqual([]);
      expect(complete.Condition).toBeUndefined();
    }
  });
  test("unknown keys, non-bundles, and mismatched resource types are ignored", () => {
    expect(normalizePrefetch({ patient: { resourceType: "Patient", id: "patient-a" }, somethingElse: bundle([{ resource: condition }]) })).toEqual({ resources: [], complete: {} });
    expect(normalizePrefetch({ tasks: bundle([{ resource: condition }], { total: 0 }) }).resources).toEqual([]);
    expect(normalizePrefetch(undefined)).toEqual({ resources: [], complete: {} });
  });
});

describe("patient-view rules", () => {
  test("no findings returns an empty card list rather than a reassurance card", () => {
    expect(copdCards(evaluateCopd(fixture()), "https://waypoint.example")).toEqual([]);
  });

  test("rule 1: post-discharge home-health findings with no ambulatory review since", () => {
    const input = fixture();
    input.resources.push(hospitalization(), homeHealthResponse("2026-09-08T11:00:00Z"));
    const findings = evaluateCopd(input).findings;
    const review = findings.find(finding => finding.category === "HOME_HEALTH_REVIEW");
    expect(review?.title).toBe("New post-discharge home-health findings require review");
    expect(review?.detail).toContain("Review respiratory status, medications, and follow-up needs.");

    input.resources.push({ resourceType: "Encounter", id: "office-visit", subject: { reference: "Patient/patient-a" }, status: "finished", class: { code: "AMB" }, period: { start: "2026-09-09T09:00:00Z" } } as fhir4.Encounter);
    expect(evaluateCopd(input).findings.some(finding => finding.category === "HOME_HEALTH_REVIEW")).toBe(false);
  });
  test("rule 1: home-health findings recorded before the transition do not fire, and the rule is configurable", () => {
    const input = fixture();
    input.resources.push(hospitalization(), homeHealthResponse("2026-08-20T11:00:00Z"));
    expect(evaluateCopd(input).findings.some(finding => finding.category === "HOME_HEALTH_REVIEW")).toBe(false);

    const enabled = fixture();
    enabled.resources.push(hospitalization(), homeHealthResponse("2026-09-08T11:00:00Z"));
    enabled.config = { ...enabled.config, homeHealthReviewEnabled: false };
    expect(evaluateCopd(enabled).findings.some(finding => finding.category === "HOME_HEALTH_REVIEW")).toBe(false);
  });
  test("rule 1: incomplete home-health coverage reports insufficient data instead of a card", () => {
    const input = fixture();
    input.resources.push(hospitalization(), homeHealthResponse("2026-09-08T11:00:00Z"));
    input.complete.QuestionnaireResponse = false;
    const result = evaluateCopd(input);
    expect(result.findings.some(finding => finding.category === "HOME_HEALTH_REVIEW")).toBe(false);
    expect(result.insufficientData.join(" ")).toContain("Home-health");
  });

  test("rule 2: a confirmed discrepancy uses the medication reconciliation wording and link", () => {
    const input = fixture();
    input.resources.push(...medicationEvidence());
    const cards = copdCards(evaluateCopd(input), "https://waypoint.example");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.summary).toBe("COPD medication discrepancy requires review");
    expect(cards[0]!.detail).toContain("The medication list and patient-reported use do not currently match.");
    expect(cards[0]!.links[0]!.label).toBe("Review medication reconciliation");
    expect(cards[0]!.links[0]!.url).toBe("https://waypoint.example/patients/patient-a/medications");
  });
  test("rule 2: several discrepant medications stay one card", () => {
    const input = fixture();
    const [order, statement] = medicationEvidence();
    input.resources.push(order!, statement!, { ...order, id: "budesonide", medicationCodeableConcept: { text: "Budesonide" } } as fhir4.MedicationRequest, { ...statement, id: "budesonide-report", medicationCodeableConcept: { text: "Budesonide" }, basedOn: [{ reference: "MedicationRequest/budesonide" }] } as fhir4.MedicationStatement);
    const result = evaluateCopd(input);
    expect(result.findings).toHaveLength(2);
    expect(prioritizedFindings(result.findings)).toHaveLength(1);
  });

  test("rule 3: increased rescue use stands alone, is configurable, and never claims an exacerbation", () => {
    const input = fixture();
    input.resources.push(rescueSignal());
    const cards = copdCards(evaluateCopd(input), "https://waypoint.example");
    expect(cards).toHaveLength(1);
    expect(cards[0]!.summary).toBe("Increased rescue medication use reported");
    expect(cards[0]!.detail).toContain("higher than the documented baseline");
    expect(cards[0]!.detail).not.toMatch(/exacerbation is occurring|deteriorating/i);

    input.config = { ...input.config, rescueUseReviewEnabled: false };
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("rule 3: the composite worsening rule replaces the standalone rescue card", () => {
    const input = fixture();
    input.resources.push(hospitalization(), rescueSignal());
    const findings = evaluateCopd(input).findings;
    expect(findings.some(finding => finding.category === "WORSENING_COPD_PATTERN")).toBe(true);
    expect(findings.some(finding => finding.category === "RESCUE_MEDICATION_USE")).toBe(false);
  });

  test("rules 4 and 5 use the configured care-transition wording", () => {
    const followup = fixture();
    followup.resources.push(hospitalization());
    followup.config = { ...followup.config, rehabReviewEnabled: false };
    const followupCard = copdCards(evaluateCopd(followup), "https://waypoint.example")[0]!;
    expect(followupCard.summary).toBe("COPD follow-up may need attention");
    expect(followupCard.detail).toContain("No qualifying post-discharge follow-up is currently documented.");
    expect(followupCard.links[0]!.label).toBe("Review care transitions");

    const rehab = fixture();
    rehab.resources.push(hospitalization(), { resourceType: "Appointment", id: "followup", status: "booked", participant: [{ actor: { reference: "Patient/patient-a" }, status: "accepted" }], start: "2026-09-15T12:00:00Z", serviceType: [{ coding: [{ system: "https://waypoint.example/fhir/CodeSystem/copd-cds", code: "copd-follow-up" }] }] } as fhir4.Appointment);
    const rehabCard = copdCards(evaluateCopd(rehab), "https://waypoint.example")[0]!;
    expect(rehabCard.summary).toBe("Pulmonary rehabilitation referral not documented");
    expect(rehabCard.detail).toContain("No pulmonary rehabilitation referral is currently documented in the available record.");
    expect(rehabCard.links[0]!.label).toBe("Review pulmonary rehab");
  });

  test("nonselective beta-blocker in COPD is raised for review, cardioselective agents are not", () => {
    const order = (id: string, text: string): fhir4.MedicationRequest => ({ resourceType: "MedicationRequest", id, status: "active", intent: "order", subject: { reference: "Patient/patient-a" }, medicationCodeableConcept: { text } });
    const reported = (id: string, text: string): fhir4.MedicationStatement => ({ resourceType: "MedicationStatement", id, status: "active", subject: { reference: "Patient/patient-a" }, medicationCodeableConcept: { text }, informationSource: { display: "Home health nurse" }, dateAsserted: "2026-09-08T12:00:00Z" });

    const cardioselective = fixture();
    cardioselective.resources.push(order("metoprolol", "Metoprolol succinate 50 mg"));
    expect(evaluateCopd(cardioselective).findings.some(finding => finding.ruleId === "nonselective-beta-blocker-copd-review")).toBe(false);

    const nonselective = fixture();
    nonselective.resources.push(reported("propranolol", "Propranolol 40 mg"), order("albuterol", "Albuterol 90 mcg inhaler"));
    const finding = evaluateCopd(nonselective).findings.find(item => item.ruleId === "nonselective-beta-blocker-copd-review")!;
    expect(finding.category).toBe("MEDICATION_SAFETY");
    expect(finding.title).toBe("Medication requires COPD-specific review");
    expect(finding.explanation).toContain("Propranolol");
    expect(finding.explanation).toContain("Albuterol");
    expect(finding.explanation).not.toMatch(/cannot be taken together|is contraindicated|discontinue|stop the/i);
    expect(finding.explanation).toContain("not a contraindication");
    expect(finding.persistent).toBe(true);

    nonselective.config = { ...nonselective.config, betaBlockerReviewEnabled: false };
    expect(evaluateCopd(nonselective).findings.some(item => item.ruleId === "nonselective-beta-blocker-copd-review")).toBe(false);
  });

  test("medication safety outranks reconciliation when both are open", () => {
    const input = fixture();
    input.resources.push(...medicationEvidence(), { resourceType: "MedicationStatement", id: "propranolol", status: "active", subject: { reference: "Patient/patient-a" }, medicationCodeableConcept: { text: "Propranolol 40 mg" }, informationSource: { display: "Home health nurse" }, dateAsserted: "2026-09-08T12:00:00Z" } as fhir4.MedicationStatement);
    const cards = copdCards(evaluateCopd(input), "https://waypoint.example");
    expect(cards[0]!.summary).toBe("Medication requires COPD-specific review");
    expect(cards[0]!.links[0]!.label).toBe("Review medication reconciliation");
  });

  test("a fully loaded patient is prioritized down to at most three non-overlapping cards", () => {
    const input = fixture();
    input.resources.push(hospitalization(), ...medicationEvidence(), homeHealthResponse("2026-09-08T11:00:00Z"), rescueSignal());
    const cards = copdCards(evaluateCopd(input), "https://waypoint.example");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(3);
    expect(new Set(cards.map(card => card.summary)).size).toBe(cards.length);
    expect(JSON.stringify(cards)).not.toMatch(LEGACY_TERMS);
  });

  test("cards never leak the launch URL as a patient query parameter", () => {
    const input = fixture();
    input.resources.push(...medicationEvidence());
    const [card] = copdCards(evaluateCopd(input), "https://waypoint.example", "https://app.medblocks.com/launch");
    expect(card!.links[0]!.url).toBe("https://app.medblocks.com/launch");
    expect(card!.links[0]!.url).not.toContain("patient=");
    expect(JSON.parse(card!.links[0]!.appContext!)).toEqual({ patientId: "patient-a", path: "/patients/patient-a/medications" });
  });
});

describe("duplicate DetectedIssue and Task prevention", () => {
  test("the same evidence keeps the same finding identity across evaluations", () => {
    const input = fixture();
    input.resources.push(...medicationEvidence());
    expect(evaluateCopd(input).findings[0]!.id).toBe(evaluateCopd({ ...input, now: NOW }).findings[0]!.id);
  });
  test("an existing DetectedIssue is referenced rather than duplicated, and a mitigated one is dropped", () => {
    const input = fixture();
    input.resources.push(...medicationEvidence());
    const finding = evaluateCopd(input).findings[0]!;
    const issue: fhir4.DetectedIssue = { resourceType: "DetectedIssue", id: "issue-1", patient: { reference: "Patient/patient-a" }, status: "preliminary", identifier: [{ system: "https://waypoint.example/fhir/identifier/copd-cds", value: finding.id }] };
    input.resources.push(issue);
    const linked = evaluateCopd(input).findings;
    expect(linked).toHaveLength(1);
    expect(linked[0]!.detectedIssueId).toBe("issue-1");

    issue.mitigation = [{ action: { text: "Reconciled with the patient" } }];
    expect(evaluateCopd(input).findings).toHaveLength(0);
  });
  test("non-persistent findings never create a DetectedIssue or Task", () => {
    const input = fixture();
    input.resources.push(rescueSignal());
    expect(evaluateCopd(input).findings.every(finding => finding.persistent === false)).toBe(true);
  });
});

describe("handleCopdHook request contract", () => {
  const context = { patientId: "patient-a", userId: "Practitioner/clinician-1" };

  test("rejects a body whose hook does not match the invoked service", async () => {
    const response = await handleCopdHook(post("waypoint-patient-view", { hook: "order-sign", hookInstance: "abc", context }), "patient-view");
    expect(response.status).toBe(400);
  });
  test("requires hookInstance, context.patientId, and context.userId", async () => {
    for (const body of [{ hook: "patient-view", context }, { hook: "patient-view", hookInstance: "abc", context: { userId: "u" } }, { hook: "patient-view", hookInstance: "abc", context: { patientId: "patient-a" } }]) {
      expect((await handleCopdHook(post("waypoint-patient-view", body), "patient-view")).status).toBe(400);
    }
  });
  test("rejects a malformed patient identifier instead of guessing a demo patient", async () => {
    const response = await handleCopdHook(post("waypoint-patient-view", { hook: "patient-view", hookInstance: "abc", context: { ...context, patientId: "../Patient/maria" } }), "patient-view");
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toMatch(/maria/i);
  });
  test("rejects an invalid JSON body without leaking internals", async () => {
    const response = await handleCopdHook(new Request("http://localhost/cds-services/waypoint-patient-view", { method: "POST", body: "{not json" }), "patient-view");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body." });
  });
  test("requires an authorized CDS client", async () => {
    const previous = process.env.CDS_ALLOW_ANONYMOUS_DEMO;
    delete process.env.CDS_ALLOW_ANONYMOUS_DEMO;
    const response = await handleCopdHook(post("waypoint-patient-view", { hook: "patient-view", hookInstance: "abc", context }), "patient-view");
    expect(response.status).toBe(401);
    if (previous !== undefined) process.env.CDS_ALLOW_ANONYMOUS_DEMO = previous;
  });
});
