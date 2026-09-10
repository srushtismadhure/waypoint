/**
 * CDS Hooks (https://cds-hooks.org) medication-safety services — order-select and order-sign.
 *
 * DEMONSTRATION IMPLEMENTATION: evaluates a short, configured set of rules (see
 * medication-config.ts) against real patient FHIR data. This is not a pharmacy-grade
 * drug-interaction system and every rule requires institutional/clinical validation
 * before any real use.
 */
import { searchFhirResource } from "./fhir-server-client.js";
import { formatConditionText, referencesPatient } from "./formatters.js";
import { categorizeMedicationText, MEDICATION_CDS_RULES, PREGNANCY_KEYWORDS, QT_PROLONGING_KEYWORDS, RULESET_VERSION } from "./medication-config.js";
import { createDetectedIssue, MEDICATION_NONADHERENCE_KEYWORDS } from "./medications.js";
import type { CdsHooksCard, CdsHooksResponse } from "./medication-types";
import { hasCopdCondition } from "./copd-cds";

function medicationDisplayText(resource: { medicationCodeableConcept?: fhir4.CodeableConcept; medicationReference?: fhir4.Reference }): string {
  return (
    resource.medicationCodeableConcept?.text ??
    resource.medicationCodeableConcept?.coding?.[0]?.display ??
    resource.medicationReference?.display ??
    "Unknown medication"
  );
}

/**
 * Targeted prefetch. Every key below is consumed by at least one deterministic COPD rule; anything a
 * rule only needs occasionally (Appointment, ServiceRequest, CarePlan) is fetched server-side instead.
 * A prefetch key is only trusted when the CDS client supplies a complete, non-paged searchset bundle.
 */
export const COPD_PATIENT_VIEW_PREFETCH = {
  patient: "Patient/{{context.patientId}}",
  conditions: "Condition?patient={{context.patientId}}&_count=200",
  encounters: "Encounter?patient={{context.patientId}}&_count=200",
  observations: "Observation?patient={{context.patientId}}&_count=200",
  medicationRequests: "MedicationRequest?patient={{context.patientId}}&_count=200",
  medicationStatements: "MedicationStatement?patient={{context.patientId}}&_count=200",
  questionnaireResponses: "QuestionnaireResponse?patient={{context.patientId}}&_count=200",
  detectedIssues: "DetectedIssue?patient={{context.patientId}}&_count=200",
  tasks: "Task?patient={{context.patientId}}&_count=200",
} as const;

const MEDICATION_ORDER_DESCRIPTION = "Surfaces an unresolved COPD medication reconciliation discrepancy for a medication being ordered. Interaction and dose checking stays disabled until an institution-validated medication safety source is configured.";

export const CDS_SERVICES_DISCOVERY = {
  services: [
    {
      id: "waypoint-patient-view",
      hook: "patient-view",
      title: "Waypoint COPD Care Transitions",
      description: "Surfaces actionable COPD post-acute, medication, home-health, and care-transition findings.",
      usageRequirements: "Deterministic rules over clinician-confirmed FHIR data. No numeric risk predictions and no prescribing recommendations.",
      prefetch: COPD_PATIENT_VIEW_PREFETCH,
    },
    { id: "waypoint-order-select", hook: "order-select", title: "Waypoint COPD medication order review", description: `${MEDICATION_ORDER_DESCRIPTION} Scoped to the medications currently selected by the clinician.` },
    { id: "waypoint-order-sign", hook: "order-sign", title: "Waypoint COPD medication order review (pre-signature)", description: `${MEDICATION_ORDER_DESCRIPTION} Runs immediately before signature across every unresolved reconciliation discrepancy, not only the drafted medication.` },
  ],
};

export interface CdsHooksRequestBody {
  hook?: string;
  hookInstance?: string;
  context?: {
    patientId?: string;
    userId?: string;
    draftOrders?: fhir4.Bundle;
  };
}

interface EvaluationEvidence {
  ruleId: string;
  medicationRequestId?: string;
  implicatedReferences: string[];
}

export interface MedicationSafetyEvaluation {
  cards: CdsHooksCard[];
  evidence: EvaluationEvidence[];
}

function extractDraftMedicationRequests(body: CdsHooksRequestBody): fhir4.MedicationRequest[] {
  const bundle = body.context?.draftOrders;
  return (bundle?.entry ?? [])
    .map(e => e.resource)
    .filter((r): r is fhir4.MedicationRequest => !!r && r.resourceType === "MedicationRequest");
}

/** The single rule-evaluation function used by both order-select/order-sign CDS Hooks AND the "Run Safety Review" REST endpoint. */
export async function evaluateMedicationSafety(patientId: string, draftMedicationRequests: fhir4.MedicationRequest[], options?: { profile: "copd" }): Promise<MedicationSafetyEvaluation> {
  const cards: CdsHooksCard[] = [];
  const evidence: EvaluationEvidence[] = [];

  // This keyword-based demo ruleset was configured for a different condition and is not validated for COPD.
  if (options?.profile === "copd") return { cards, evidence };

  if (!patientId || draftMedicationRequests.length === 0) {
    return { cards, evidence };
  }

  const query = `patient=${encodeURIComponent(patientId)}`;
  const [mrRes, msRes, allergyRes, conditionRes, diRes] = await Promise.all([
    searchFhirResource<fhir4.Bundle>("MedicationRequest", query),
    searchFhirResource<fhir4.Bundle>("MedicationStatement", query),
    searchFhirResource<fhir4.Bundle>("AllergyIntolerance", query),
    searchFhirResource<fhir4.Bundle>("Condition", query),
    searchFhirResource<fhir4.Bundle>("DetectedIssue", query),
  ]);

  function entries<T extends { resourceType: string }>(bundle: fhir4.Bundle | undefined, resourceType: string): T[] {
    return (bundle?.entry ?? []).map(e => e.resource).filter((r): r is T => !!r && r.resourceType === resourceType);
  }

  const existingRequests = entries<fhir4.MedicationRequest>(mrRes.body, "MedicationRequest").filter(r => referencesPatient(r.subject, patientId));
  const statements = entries<fhir4.MedicationStatement>(msRes.body, "MedicationStatement").filter(r => referencesPatient(r.subject, patientId));
  const allergies = entries<fhir4.AllergyIntolerance>(allergyRes.body, "AllergyIntolerance").filter(r => referencesPatient(r.patient, patientId));
  const conditions = entries<fhir4.Condition>(conditionRes.body, "Condition").filter(r => referencesPatient(r.subject, patientId));
  if (conditions.some(hasCopdCondition)) return { cards, evidence };
  const existingIssues = entries<fhir4.DetectedIssue>(diRes.body, "DetectedIssue").filter(r => referencesPatient(r.patient, patientId));

  const activeExisting = existingRequests.filter(r => r.status === "active");
  const conditionTexts = conditions.map(formatConditionText).join(" ").toLowerCase();

  function addCard(ruleId: keyof typeof MEDICATION_CDS_RULES, implicatedReferences: string[], medicationRequestId?: string) {
    const rule = MEDICATION_CDS_RULES[ruleId];
    if (!rule) return;

    const indicator = rule.severity === "high" ? "critical" : rule.severity === "moderate" ? "warning" : "info";
    cards.push({
      summary: rule.summary,
      indicator,
      detail: `${rule.detail}\n\n${rule.disclaimer}`,
      source: { label: "Waypoint medication safety (demonstration)" },
      suggestions: rule.suggestedActions.map(label => ({ label })),
      links: implicatedReferences.map(ref => ({ label: `Evidence: ${ref}`, url: `/fhir/${ref}`, type: "absolute" as const })),
      selectionBehavior: "at-most-one",
      overrideReasons: [
        { code: "clinician-reviewed", display: "Reviewed — continue with documented reason" },
        { code: "not-clinically-relevant", display: "Not clinically relevant for this patient" },
      ],
    });
    evidence.push({ ruleId, medicationRequestId, implicatedReferences });
  }

  for (const draft of draftMedicationRequests) {
    const draftText = medicationDisplayText(draft).toLowerCase();
    const draftId = draft.id;

    // Already-resolved issues for this exact draft should not re-fire.
    const alreadyResolved = existingIssues.some(
      issue => issue.status === "final" && issue.implicated?.some(ref => ref.reference === `MedicationRequest/${draftId}`),
    );
    if (alreadyResolved) continue;

    // 1. Allergy / intolerance conflict
    const allergyMatch = allergies.find(a => {
      const text = (a.code?.text ?? a.code?.coding?.[0]?.display ?? "").toLowerCase();
      return text && draftText.includes(text);
    });
    if (allergyMatch) addCard("allergy-conflict", [`AllergyIntolerance/${allergyMatch.id}`, `MedicationRequest/${draftId}`], draftId);

    // 2. Pregnancy + mycophenolate
    const category = categorizeMedicationText(draftText);
    if (category?.id === "mycophenolate" && PREGNANCY_KEYWORDS.some(k => conditionTexts.includes(k))) {
      const pregnancyCondition = conditions.find(c => PREGNANCY_KEYWORDS.some(k => formatConditionText(c).toLowerCase().includes(k)));
      addCard("pregnancy-mycophenolate", [`MedicationRequest/${draftId}`, ...(pregnancyCondition ? [`Condition/${pregnancyCondition.id}`] : [])], draftId);
    }

    // 3. Hydroxychloroquine + configured QT-prolonging medication
    if (category?.id === "hydroxychloroquine") {
      const qtMatch = activeExisting.find(r => QT_PROLONGING_KEYWORDS.some(k => medicationDisplayText(r).toLowerCase().includes(k)));
      if (qtMatch) addCard("hydroxychloroquine-qt-combo", [`MedicationRequest/${draftId}`, `MedicationRequest/${qtMatch.id}`], draftId);
    }

    // 4. Duplicate active medication (same category already active)
    if (category) {
      const duplicate = activeExisting.find(r => r.id !== draftId && categorizeMedicationText(medicationDisplayText(r))?.id === category.id);
      if (duplicate) addCard("duplicate-active-medication", [`MedicationRequest/${draftId}`, `MedicationRequest/${duplicate.id}`], draftId);
    }

    // 5. Refill interruption / nonadherence documented for this medication
    const relatedStatement = [...statements]
      .filter(s => medicationDisplayText(s).toLowerCase() === draftText)
      .sort((a, b) => (a.dateAsserted ?? "").localeCompare(b.dateAsserted ?? ""))
      .pop();
    if (relatedStatement) {
      const noteText = (relatedStatement.note?.[0]?.text ?? "").toLowerCase();
      const nonadherent =
        relatedStatement.status === "stopped" ||
        relatedStatement.status === "not-taken" ||
        MEDICATION_NONADHERENCE_KEYWORDS.some(k => noteText.includes(k));
      if (nonadherent) addCard("refill-interruption", [`MedicationStatement/${relatedStatement.id}`, `MedicationRequest/${draftId}`], draftId);
    }
  }

  return { cards, evidence };
}

export interface PersistedConflict {
  detectedIssueId: string;
  ruleId: string;
  severity: string;
  summary: string;
  medicationRequestId?: string;
}

/** Persists a DetectedIssue for every rule that fired during evaluation, returning real IDs so the client can act on (resolve) each one. */
export async function persistDetectedIssuesFromEvaluation(patientId: string, evaluation: MedicationSafetyEvaluation): Promise<PersistedConflict[]> {
  const persisted: PersistedConflict[] = [];
  for (const item of evaluation.evidence) {
    const rule = MEDICATION_CDS_RULES[item.ruleId];
    if (!rule) continue;
    const result = await createDetectedIssue({
      patientId,
      ruleId: rule.id,
      ruleVersion: RULESET_VERSION,
      severity: rule.severity,
      summary: rule.summary,
      medicationRequestId: item.medicationRequestId,
      implicatedReferences: item.implicatedReferences,
    });
    if (result.ok) {
      persisted.push({ detectedIssueId: result.id, ruleId: rule.id, severity: rule.severity, summary: rule.summary, medicationRequestId: item.medicationRequestId });
    }
  }
  return persisted;
}

export function cdsHooksResponse(evaluation: MedicationSafetyEvaluation): CdsHooksResponse {
  return { cards: evaluation.cards };
}
