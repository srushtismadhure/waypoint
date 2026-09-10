import { createFhirResource, readFhirResource, searchFhirResource, updateFhirResource } from "./fhir-server-client.js";
import { formatMedicationText, referencesPatient } from "./formatters.js";
import {
  categorizeMedicationText,
  MONITORING_REQUIREMENTS,
  NONADHERENCE_KEYWORDS,
  RULESET_VERSION,
  type MedicationCategoryGroup,
} from "./medication-config.js";
import { classifyCopdMedication } from "./copd-medication-catalog.js";
import { COPD_FINDING_SYSTEM, hasCopdCondition, patientIdValid } from "./copd-cds";
import { evaluateCopdPatient, resolveCopdIssue } from "./copd-cds-service";
import { getLatestObservation, filterObservationsByLoinc } from "./fhir-observations.js";
import type {
  AllergyView,
  DetectedIssueView,
  MedicationAdministrationView,
  MedicationPatientState,
  MedicationRegimenItem,
  MedicationSafetyCounts,
  MedicationStatementView,
  MonitoringStatusView,
  ReconciliationIssueView,
  SymptomAssessmentSummary,
} from "./medication-types";

const NOTE_TAG = {
  indication: "[indication]",
  treatmentPhase: "[treatment-phase]",
  clinicalNote: "[note]",
  holdReason: "[hold-reason]",
  stopReason: "[stop-reason]",
} as const;

function annotation(text: string, authorDisplay?: string): fhir4.Annotation {
  return { text, time: new Date().toISOString(), ...(authorDisplay ? { authorReference: { display: authorDisplay } } : {}) };
}

function parseTaggedNote(notes: fhir4.Annotation[] | undefined, tag: string): string | undefined {
  return notes?.find(n => n.text?.startsWith(tag))?.text?.slice(tag.length).trim();
}

function isOperationOutcome(value: unknown): value is fhir4.OperationOutcome {
  return typeof value === "object" && value !== null && (value as { resourceType?: string }).resourceType === "OperationOutcome";
}

const MONITORING_TASK_DESCRIPTION = "Medication monitoring follow-up";

function medicationDisplayText(resource: { medicationCodeableConcept?: fhir4.CodeableConcept; medicationReference?: fhir4.Reference }): string {
  return (
    resource.medicationCodeableConcept?.text ??
    resource.medicationCodeableConcept?.coding?.[0]?.display ??
    resource.medicationReference?.display ??
    "Unknown medication"
  );
}

// ---------------------------------------------------------------------------
// Fetch + assemble patient medication state (read model)
// ---------------------------------------------------------------------------

interface PatientMedicationResources {
  medicationRequests: fhir4.MedicationRequest[];
  medicationStatements: fhir4.MedicationStatement[];
  medicationAdministrations: fhir4.MedicationAdministration[];
  allergies: fhir4.AllergyIntolerance[];
  detectedIssues: fhir4.DetectedIssue[];
  tasks: fhir4.Task[];
  assessments: fhir4.QuestionnaireResponse[];
}

async function fetchPatientMedicationResources(patientId: string): Promise<PatientMedicationResources> {
  const query = `patient=${encodeURIComponent(patientId)}`;
  const [mrRes, msRes, maRes, allergyRes, diRes, taskRes, qrRes] = await Promise.all([
    searchFhirResource<fhir4.Bundle>("MedicationRequest", query),
    searchFhirResource<fhir4.Bundle>("MedicationStatement", query),
    searchFhirResource<fhir4.Bundle>("MedicationAdministration", query),
    searchFhirResource<fhir4.Bundle>("AllergyIntolerance", `patient=${encodeURIComponent(patientId)}`),
    searchFhirResource<fhir4.Bundle>("DetectedIssue", `patient=${encodeURIComponent(patientId)}`),
    searchFhirResource<fhir4.Bundle>("Task", query),
    searchFhirResource<fhir4.Bundle>("QuestionnaireResponse", `subject=${encodeURIComponent(`Patient/${patientId}`)}`),
  ]);

  function entries<T extends { resourceType: string }>(bundle: fhir4.Bundle | undefined, resourceType: string): T[] {
    return (bundle?.entry ?? []).map(e => e.resource).filter((r): r is T => !!r && r.resourceType === resourceType);
  }

  return {
    medicationRequests: entries<fhir4.MedicationRequest>(mrRes.body, "MedicationRequest").filter(r => referencesPatient(r.subject, patientId)),
    medicationStatements: entries<fhir4.MedicationStatement>(msRes.body, "MedicationStatement").filter(r => referencesPatient(r.subject, patientId)),
    medicationAdministrations: entries<fhir4.MedicationAdministration>(maRes.body, "MedicationAdministration").filter(r =>
      referencesPatient((r as fhir4.MedicationAdministration).subject, patientId),
    ),
    allergies: entries<fhir4.AllergyIntolerance>(allergyRes.body, "AllergyIntolerance").filter(r => referencesPatient(r.patient, patientId)),
    detectedIssues: entries<fhir4.DetectedIssue>(diRes.body, "DetectedIssue").filter(r => referencesPatient(r.patient, patientId)),
    tasks: entries<fhir4.Task>(taskRes.body, "Task").filter(t => (t.for ? referencesPatient(t.for, patientId) : false)),
    assessments: entries<fhir4.QuestionnaireResponse>(qrRes.body, "QuestionnaireResponse").filter(r => referencesPatient(r.subject, patientId)),
  };
}

function deriveMonitoringForCategory(categoryId: string | undefined, observations: fhir4.Observation[]): MonitoringStatusView[] {
  if (!categoryId) return [];
  return MONITORING_REQUIREMENTS.filter(req => req.categoryId === categoryId).map(req => {
    if (!req.loincCode) {
      return { label: req.label, status: "unavailable" as const };
    }
    const matches = filterObservationsByLoinc(observations, req.loincCode);
    const latest = getLatestObservation(matches);
    const latestDate = latest?.effectiveDateTime ?? latest?.issued;
    if (!latestDate) return { label: req.label, status: "insufficient-information" as const };

    const overdue = req.intervalDays !== undefined && Date.now() - Date.parse(latestDate) > req.intervalDays * 24 * 60 * 60 * 1000;
    return { label: req.label, status: overdue ? ("overdue" as const) : ("current" as const), lastDate: latestDate };
  });
}

function findMatchingStatement(mr: fhir4.MedicationRequest, statements: fhir4.MedicationStatement[]): fhir4.MedicationStatement | undefined {
  const mrText = formatMedicationText(mr).toLowerCase();
  const sorted = [...statements].sort((a, b) => (a.dateAsserted ?? "").localeCompare(b.dateAsserted ?? ""));
  return [...sorted].reverse().find(statement => medicationDisplayText(statement).toLowerCase() === mrText);
}

function sortedDosageInstructions(mr: fhir4.MedicationRequest): fhir4.Dosage[] {
  return [...(mr.dosageInstruction ?? [])].sort((a, b) =>
    (a.timing?.repeat?.boundsPeriod?.start ?? "").localeCompare(b.timing?.repeat?.boundsPeriod?.start ?? ""),
  );
}

function currentDosageInstruction(mr: fhir4.MedicationRequest): fhir4.Dosage | undefined {
  const sorted = sortedDosageInstructions(mr);
  return [...sorted].reverse().find(dosage => !dosage.timing?.repeat?.boundsPeriod?.end) ?? sorted.at(-1);
}

function buildRegimenItem(
  mr: fhir4.MedicationRequest,
  statements: fhir4.MedicationStatement[],
  observations: fhir4.Observation[],
): MedicationRegimenItem {
  const text = formatMedicationText(mr);
  const category = categorizeMedicationText(text);
  const copd = classifyCopdMedication(text);
  const coding = mr.medicationCodeableConcept?.coding?.[0];
  const sortedDosages = sortedDosageInstructions(mr);
  const dosage = currentDosageInstruction(mr);
  const doseQuantity = dosage?.doseAndRate?.[0]?.doseQuantity;
  const matchingStatement = findMatchingStatement(mr, statements);

  return {
    id: mr.id!,
    medicationText: text,
    medicationSystem: coding?.system,
    medicationCode: coding?.code,
    categoryId: category?.id,
    categoryLabel: category?.label,
    categoryGroup: category?.group ?? "other",
    genericName: copd?.genericName,
    brandName: copd?.brandName,
    medicationClass: copd?.medicationClass,
    therapyRole: copd?.therapyRole,
    status: mr.status,
    intent: mr.intent,
    dose: doseQuantity?.value !== undefined ? `${doseQuantity.value}${doseQuantity.unit ? ` ${doseQuantity.unit}` : ""}` : undefined,
    route: dosage?.route?.text ?? dosage?.route?.coding?.[0]?.display,
    frequency: dosage?.timing?.code?.text ?? dosage?.text,
    startDate: sortedDosages[0]?.timing?.repeat?.boundsPeriod?.start ?? mr.authoredOn,
    expectedEndDate: dosage?.timing?.repeat?.boundsPeriod?.end,
    indication: parseTaggedNote(mr.note, NOTE_TAG.indication) ?? mr.reasonReference?.[0]?.display ?? mr.reasonCode?.[0]?.text,
    treatmentPhase: parseTaggedNote(mr.note, NOTE_TAG.treatmentPhase),
    orderingClinician: mr.requester?.display,
    patientReportedUseText: matchingStatement ? medicationStatementSummary(matchingStatement) : undefined,
    patientReportedUseDate: matchingStatement?.dateAsserted ?? matchingStatement?.effectiveDateTime,
    lastReconciliationDate: matchingStatement?.dateAsserted,
    monitoring: deriveMonitoringForCategory(category?.id, observations),
    priorPrescriptionId: mr.priorPrescription?.reference?.split("/").pop(),
    note: parseTaggedNote(mr.note, NOTE_TAG.clinicalNote),
    reconciliationStatus: matchingStatement ? ((matchingStatement.status === "not-taken" || matchingStatement.status === "stopped") ? "needs-review" : "reconciled") : "not-reviewed",
    discrepancyType: matchingStatement?.status === "not-taken" ? "Not taking / medication unavailable" : matchingStatement?.status === "stopped" ? "Patient reports stopped" : undefined,
  };
}

function medicationStatementSummary(statement: fhir4.MedicationStatement): string {
  const dose = statement.dosage?.[0]?.text;
  const statusText = statement.status === "stopped" ? "Reported stopped" : statement.status === "not-taken" ? "Reported not taken" : "Reported taking";
  return dose ? `${statusText} — ${dose}` : statusText;
}

function detectReconciliationIssues(
  regimen: MedicationRegimenItem[],
  medicationRequests: fhir4.MedicationRequest[],
  statements: fhir4.MedicationStatement[],
): ReconciliationIssueView[] {
  const issues: ReconciliationIssueView[] = [];

  for (const item of regimen) {
    if (item.status !== "active") continue;
    const mr = medicationRequests.find(r => r.id === item.id);
    if (!mr) continue;
    const matchingStatement = findMatchingStatement(mr, statements);

    if (!matchingStatement) continue; // no patient-reported data at all — handled as a monitoring/insufficient-info signal, not a discrepancy

    const orderedDose = currentDosageInstruction(mr)?.text ?? item.dose ?? "dose not specified";
    const reportedDose = matchingStatement.dosage?.[0]?.text;
    const statusMismatch = matchingStatement.status === "stopped" || matchingStatement.status === "not-taken";
    const doseMismatch = reportedDose && orderedDose && reportedDose.trim().toLowerCase() !== orderedDose.trim().toLowerCase();

    if (statusMismatch || doseMismatch) {
      issues.push({
        medicationRequestId: item.id,
        medicationText: item.medicationText,
        orderedSummary: `${item.medicationText}${item.dose ? ` ${item.dose}` : ""}${item.frequency ? ` ${item.frequency}` : ""}`.trim(),
        reportedSummary: medicationStatementSummary(matchingStatement),
        statementId: matchingStatement.id,
      });
    }
  }

  return issues;
}

function buildDetectedIssueView(issue: fhir4.DetectedIssue): DetectedIssueView {
  const ruleCode = issue.code?.coding?.[0]?.code;
  const mitigation = issue.mitigation?.[0];
  return {
    id: issue.id!,
    ruleId: ruleCode,
    ruleVersion: issue.detail?.match(/version:(\S+)/)?.[1],
    severity: issue.severity ?? "unknown",
    summary: issue.code?.text ?? issue.detail,
    status: issue.status,
    implicatedMedicationRequestIds: (issue.implicated ?? [])
      .filter(ref => ref.reference?.includes("MedicationRequest"))
      .map(ref => ref.reference?.split("/").pop() ?? "")
      .filter(Boolean),
    identifiedDateTime: issue.identifiedDateTime,
    mitigationAction: mitigation?.action?.text,
    mitigationAuthor: mitigation?.author?.display,
    overrideReason: parseTaggedNote(undefined, "") ?? undefined,
  };
}

function computeSafetyCounts(
  detectedIssues: DetectedIssueView[],
  regimen: MedicationRegimenItem[],
  reconciliationIssues: ReconciliationIssueView[],
  assessments: SymptomAssessmentSummary[],
  tasks: fhir4.Task[],
): MedicationSafetyCounts {
  const openConflicts = detectedIssues.filter(i => i.status !== "cancelled" && i.status !== "entered-in-error" && !i.mitigationAction).length;
  const monitoringGaps = regimen.reduce((count, item) => count + item.monitoring.filter(m => m.status === "overdue").length, 0);
  const openMedicationTasks = tasks.filter(
    t => t.status !== "completed" && t.status !== "cancelled" && t.status !== "rejected" && (t.focus?.reference?.includes("MedicationRequest") || t.description === MONITORING_TASK_DESCRIPTION),
  ).length;

  return {
    conflicts: openConflicts,
    monitoringGaps,
    reconciliationIssues: reconciliationIssues.length,
    symptomsRequiringReview: assessments.filter(a => a.requiresReview).length,
    openTasks: openMedicationTasks,
  };
}

export async function getPatientMedicationState(patient: fhir4.Patient, conditions: fhir4.Condition[]): Promise<MedicationPatientState> {
  const patientId = patient.id ?? "";
  const resources = await fetchPatientMedicationResources(patientId);

  // Pull renal + safety observations for monitoring computation (reuses existing browser-facing endpoint's server-side equivalent).
  const observationsResult = await searchFhirResource<fhir4.Bundle>("Observation", `patient=${encodeURIComponent(patientId)}`);
  const observations = (observationsResult.body?.entry ?? [])
    .map(e => e.resource)
    .filter((r): r is fhir4.Observation => !!r && r.resourceType === "Observation")
    .filter(o => referencesPatient(o.subject, patientId));

  const activeAndDraft = resources.medicationRequests.filter(mr => mr.status === "active" || mr.status === "draft" || mr.status === "on-hold");
  const inactive = resources.medicationRequests.filter(mr => !activeAndDraft.includes(mr));

  const regimenItems = activeAndDraft.map(mr => buildRegimenItem(mr, resources.medicationStatements, observations));
  const inactiveItems = inactive.map(mr => buildRegimenItem(mr, resources.medicationStatements, observations));

  const regimenByGroup: MedicationPatientState["regimenByGroup"] = {
    "lupus-nephritis-treatment": [],
    "kidney-cardiovascular-support": [],
    "preventive-supportive-care": [],
    other: [],
  };
  for (const item of regimenItems) {
    (regimenByGroup[item.categoryGroup as MedicationCategoryGroup] ??= []).push(item);
  }

  const reconciliationIssues = detectReconciliationIssues(regimenItems, activeAndDraft, resources.medicationStatements);
  const detectedIssues = resources.detectedIssues.map(buildDetectedIssueView);

  const medicationStatementViews: MedicationStatementView[] = resources.medicationStatements.map(s => ({
    id: s.id!,
    medicationText: medicationDisplayText(s),
    status: s.status,
    dose: s.dosage?.[0]?.text,
    dateAsserted: s.dateAsserted ?? s.effectiveDateTime,
    note: s.note?.[0]?.text,
  }));

  const medicationAdministrationViews: MedicationAdministrationView[] = resources.medicationAdministrations.map(a => ({
    id: a.id!,
    medicationText: medicationDisplayText(a),
    status: a.status,
    effectiveDate: a.effectiveDateTime ?? a.effectivePeriod?.start,
    dose: a.dosage?.dose?.value !== undefined ? `${a.dosage.dose.value}${a.dosage.dose.unit ? ` ${a.dosage.dose.unit}` : ""}` : undefined,
  }));

  const allergyViews: AllergyView[] = resources.allergies.map(a => ({
    id: a.id!,
    text: a.code?.text ?? a.code?.coding?.[0]?.display ?? "Documented allergy/intolerance",
    criticality: a.criticality,
    status: a.clinicalStatus?.coding?.[0]?.code,
  }));

  const assessmentSummaries: SymptomAssessmentSummary[] = resources.assessments.map(qr => {
    const items = qr.item ?? [];
    const reportedCount = items.filter(item => item.answer?.some(a => a.valueString && a.valueString !== "none")).length;
    return {
      id: qr.id!,
      authored: qr.authored,
      status: qr.status,
      reportedSymptomCount: reportedCount,
      requiresReview: reportedCount > 0 && qr.status === "completed",
    };
  });

  const safetyCounts = computeSafetyCounts(detectedIssues, regimenItems, reconciliationIssues, assessmentSummaries, resources.tasks);

  return {
    patientId,
    cohortMember: conditions.some(hasCopdCondition),
    safetyCounts,
    regimenByGroup,
    inactiveOrders: inactiveItems,
    reconciliationIssues,
    detectedIssues,
    medicationStatements: medicationStatementViews,
    medicationAdministrations: medicationAdministrationViews,
    allergies: allergyViews,
    assessments: assessmentSummaries,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Write operations
// ---------------------------------------------------------------------------

export type MedicationActionResult = { ok: true; medicationRequest: fhir4.MedicationRequest } | { ok: false; status: number; error: string };

export interface CreateDraftMedicationInput {
  patientId: string;
  medicationText: string;
  medicationSystem?: string;
  medicationCode?: string;
  indication?: string;
  treatmentPhase?: string;
  doseValue?: number;
  doseUnit?: string;
  route?: string;
  frequency?: string;
  startDate?: string;
  expectedEndDate?: string;
  encounterId?: string;
  conditionId?: string;
  prescriberDisplay: string;
  patientInstruction?: string;
  clinicalNote?: string;
}

function buildMedicationCodeableConcept(input: CreateDraftMedicationInput): fhir4.CodeableConcept {
  if (input.medicationCode && input.medicationSystem) {
    return { coding: [{ system: input.medicationSystem, code: input.medicationCode, display: input.medicationText }], text: input.medicationText };
  }
  return { text: input.medicationText };
}

async function createProvenance(targetReference: string, activity: string, actorDisplay: string, reason?: string): Promise<void> {
  const provenance: fhir4.Provenance = {
    resourceType: "Provenance",
    target: [{ reference: targetReference }],
    recorded: new Date().toISOString(),
    activity: { text: activity },
    agent: [{ who: { display: actorDisplay } }],
    ...(reason ? { reason: [{ text: reason }] } : {}),
  };
  await createFhirResource<fhir4.Provenance>("Provenance", provenance);
}

export async function createDraftMedicationRequest(input: CreateDraftMedicationInput): Promise<MedicationActionResult> {
  const notes: fhir4.Annotation[] = [];
  if (input.indication) notes.push(annotation(`${NOTE_TAG.indication}${input.indication}`));
  if (input.treatmentPhase) notes.push(annotation(`${NOTE_TAG.treatmentPhase}${input.treatmentPhase}`));
  if (input.clinicalNote) notes.push(annotation(`${NOTE_TAG.clinicalNote}${input.clinicalNote}`));

  const dosageInstruction: fhir4.Dosage = {
    text: [input.doseValue ? `${input.doseValue}${input.doseUnit ?? ""}` : undefined, input.route, input.frequency].filter(Boolean).join(" "),
    ...(input.route ? { route: { text: input.route } } : {}),
    ...(input.frequency ? { timing: { code: { text: input.frequency } } } : {}),
    ...(input.doseValue !== undefined ? { doseAndRate: [{ doseQuantity: { value: input.doseValue, unit: input.doseUnit } }] } : {}),
    ...(input.startDate || input.expectedEndDate
      ? { timing: { code: { text: input.frequency }, repeat: { boundsPeriod: { start: input.startDate, end: input.expectedEndDate } } } }
      : {}),
  };

  const medicationRequest: fhir4.MedicationRequest = {
    resourceType: "MedicationRequest",
    status: "draft",
    intent: "order",
    subject: { reference: `Patient/${input.patientId}` },
    medicationCodeableConcept: buildMedicationCodeableConcept(input),
    authoredOn: new Date().toISOString(),
    requester: { display: input.prescriberDisplay },
    dosageInstruction: [dosageInstruction],
    ...(input.encounterId ? { encounter: { reference: `Encounter/${input.encounterId}` } } : {}),
    ...(input.conditionId ? { reasonReference: [{ reference: `Condition/${input.conditionId}` }] } : {}),
    ...(input.patientInstruction ? { dosageInstruction: [{ ...dosageInstruction, patientInstruction: input.patientInstruction }] } : {}),
    ...(notes.length > 0 ? { note: notes } : {}),
  };

  const result = await createFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", medicationRequest);
  if (result.status !== 201 || isOperationOutcome(result.body)) {
    return { ok: false, status: result.status, error: "Unable to create the draft medication order." };
  }

  await createProvenance(`MedicationRequest/${result.body.id}`, "Draft medication order created", input.prescriberDisplay);
  return { ok: true, medicationRequest: result.body };
}

async function loadMedicationRequest(id: string): Promise<fhir4.MedicationRequest | null> {
  const result = await readFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", id);
  if (result.status !== 200 || isOperationOutcome(result.body)) return null;
  return result.body;
}

export async function signMedicationRequest(id: string, clinicianDisplay: string): Promise<MedicationActionResult> {
  const current = await loadMedicationRequest(id);
  if (!current) return { ok: false, status: 404, error: "Medication order not found." };
  if (current.status !== "draft") return { ok: false, status: 409, error: "Only a draft medication order can be signed." };

  const updated: fhir4.MedicationRequest = { ...current, status: "active", requester: { display: clinicianDisplay } };
  const result = await updateFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", id, updated);
  if (isOperationOutcome(result.body)) return { ok: false, status: result.status, error: "Unable to sign the medication order." };

  await createProvenance(`MedicationRequest/${id}`, "Medication order signed", clinicianDisplay);
  return { ok: true, medicationRequest: result.body };
}

export async function holdMedicationRequest(id: string, reason: string, actorDisplay: string): Promise<MedicationActionResult> {
  const current = await loadMedicationRequest(id);
  if (!current) return { ok: false, status: 404, error: "Medication order not found." };

  const updated: fhir4.MedicationRequest = {
    ...current,
    status: "on-hold",
    statusReason: { text: reason },
    note: [...(current.note ?? []), annotation(`${NOTE_TAG.holdReason}${reason}`, actorDisplay)],
  };
  const result = await updateFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", id, updated);
  if (isOperationOutcome(result.body)) return { ok: false, status: result.status, error: "Unable to hold the medication order." };

  await createProvenance(`MedicationRequest/${id}`, "Medication order placed on hold", actorDisplay, reason);
  return { ok: true, medicationRequest: result.body };
}

export async function stopMedicationRequest(id: string, reason: string, actorDisplay: string): Promise<MedicationActionResult> {
  const current = await loadMedicationRequest(id);
  if (!current) return { ok: false, status: 404, error: "Medication order not found." };

  const updated: fhir4.MedicationRequest = {
    ...current,
    status: "stopped",
    statusReason: { text: reason },
    note: [...(current.note ?? []), annotation(`${NOTE_TAG.stopReason}${reason}`, actorDisplay)],
  };
  const result = await updateFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", id, updated);
  if (isOperationOutcome(result.body)) return { ok: false, status: result.status, error: "Unable to stop the medication order." };

  await createProvenance(`MedicationRequest/${id}`, "Medication order stopped", actorDisplay, reason);
  return { ok: true, medicationRequest: result.body };
}

export async function replaceMedicationRequest(
  id: string,
  changes: Partial<CreateDraftMedicationInput>,
  actorDisplay: string,
): Promise<MedicationActionResult> {
  const current = await loadMedicationRequest(id);
  if (!current) return { ok: false, status: 404, error: "Medication order not found." };

  const stopReason = "Replaced by updated dose, route, or frequency";
  const stopped: fhir4.MedicationRequest = {
    ...current,
    status: "stopped",
    statusReason: { text: stopReason },
    note: [...(current.note ?? []), annotation(`${NOTE_TAG.stopReason}${stopReason}`, actorDisplay)],
  };
  const stopResult = await updateFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", id, stopped);
  if (isOperationOutcome(stopResult.body)) return { ok: false, status: stopResult.status, error: "Unable to stop the prior medication order." };

  const patientId = current.subject.reference?.split("/").pop() ?? "";
  const replacement: fhir4.MedicationRequest = {
    ...current,
    id: undefined,
    status: "active",
    authoredOn: new Date().toISOString(),
    requester: { display: actorDisplay },
    priorPrescription: { reference: `MedicationRequest/${id}` },
    ...(changes.doseValue !== undefined || changes.route || changes.frequency
      ? {
          dosageInstruction: [
            {
              text: [changes.doseValue ? `${changes.doseValue}${changes.doseUnit ?? ""}` : undefined, changes.route, changes.frequency]
                .filter(Boolean)
                .join(" "),
              ...(changes.route ? { route: { text: changes.route } } : {}),
              ...(changes.frequency ? { timing: { code: { text: changes.frequency } } } : {}),
              ...(changes.doseValue !== undefined ? { doseAndRate: [{ doseQuantity: { value: changes.doseValue, unit: changes.doseUnit } }] } : {}),
            },
          ],
        }
      : {}),
  };
  delete (replacement as { id?: string }).id;

  const createResult = await createFhirResource<fhir4.MedicationRequest | fhir4.OperationOutcome>("MedicationRequest", replacement);
  if (createResult.status !== 201 || isOperationOutcome(createResult.body)) {
    return { ok: false, status: createResult.status, error: "Unable to create the replacement medication order." };
  }

  await createProvenance(`MedicationRequest/${createResult.body.id}`, "Medication order replaced prior order", actorDisplay, `priorPrescription: MedicationRequest/${id}`);
  void patientId;
  return { ok: true, medicationRequest: createResult.body };
}

export interface CreateMedicationStatementInput {
  patientId: string;
  medicationRequestId?: string;
  medicationText: string;
  status: fhir4.MedicationStatement["status"];
  doseText?: string;
  note?: string;
  actorDisplay: string;
  reportedUse?: string;
}

export async function createMedicationStatement(input: CreateMedicationStatementInput): Promise<{ ok: true; id: string; cdsWarning?: string } | { ok: false; status: number; error: string }> {
  if (!patientIdValid(input.patientId)) return { ok: false, status: 400, error: "Invalid patient identity." };
  if (input.reportedUse && !["taking", "different", "unavailable", "caregiver", "unsure", "not-taking"].includes(input.reportedUse)) return { ok: false, status: 400, error: "Invalid reported medication use." };
  if (input.medicationRequestId) {
    const order = await readFhirResource<fhir4.MedicationRequest>("MedicationRequest", input.medicationRequestId);
    if (order.status !== 200 || order.body?.resourceType !== "MedicationRequest" || !referencesPatient(order.body.subject, input.patientId)) return { ok: false, status: 400, error: "Medication order does not belong to this patient." };
  }
  const statement: fhir4.MedicationStatement = {
    resourceType: "MedicationStatement",
    status: input.status,
    medicationCodeableConcept: { text: input.medicationText },
    subject: { reference: `Patient/${input.patientId}` },
    dateAsserted: new Date().toISOString(),
    informationSource: { display: input.actorDisplay },
    ...(input.reportedUse ? { extension: [{ url: "https://waypoint.example/fhir/StructureDefinition/reported-medication-use", valueCode: input.reportedUse }] } : {}),
    ...(input.doseText ? { dosage: [{ text: input.doseText }] } : {}),
    ...(input.note ? { note: [annotation(input.note, input.actorDisplay)] } : {}),
    ...(input.medicationRequestId ? { basedOn: [{ reference: `MedicationRequest/${input.medicationRequestId}` }] } : {}),
  };

  const result = await createFhirResource<fhir4.MedicationStatement | fhir4.OperationOutcome>("MedicationStatement", statement);
  if (result.status !== 201 || isOperationOutcome(result.body)) {
    return { ok: false, status: result.status, error: "Unable to record medication reconciliation." };
  }
  await createProvenance(`MedicationStatement/${result.body.id}`, "Medication reconciliation documented", input.actorDisplay);
  try { await evaluateCopdPatient(input.patientId, true); }
  catch { return { ok: true, id: result.body.id!, cdsWarning: "Reconciliation was saved, but CDS synchronization is pending. Refresh COPD decision support to retry." }; }
  return { ok: true, id: result.body.id! };
}

export interface SymptomAnswerInput {
  linkId: string;
  text: string;
  severity: "none" | "mild" | "moderate" | "severe";
  startDate?: string;
  trend?: "improving" | "unchanged" | "worsening";
  suspectedMedication?: string;
}

export interface CreateAssessmentInput {
  patientId: string;
  answers: SymptomAnswerInput[];
  actorDisplay: string;
}

export async function createMedicationAssessment(input: CreateAssessmentInput): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const items: fhir4.QuestionnaireResponseItem[] = input.answers.map(a => ({
    linkId: a.linkId,
    text: a.text,
    answer: [
      { valueString: a.severity },
      ...(a.startDate ? [{ valueString: `start:${a.startDate}` }] : []),
      ...(a.trend ? [{ valueString: `trend:${a.trend}` }] : []),
      ...(a.suspectedMedication ? [{ valueString: `suspected:${a.suspectedMedication}` }] : []),
    ],
  }));

  const questionnaireResponse: fhir4.QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    status: "completed",
    subject: { reference: `Patient/${input.patientId}` },
    authored: new Date().toISOString(),
    author: { display: input.actorDisplay },
    item: items,
  };

  const result = await createFhirResource<fhir4.QuestionnaireResponse | fhir4.OperationOutcome>("QuestionnaireResponse", questionnaireResponse);
  if (result.status !== 201 || isOperationOutcome(result.body)) {
    return { ok: false, status: result.status, error: "Unable to save the medication experience assessment." };
  }
  return { ok: true, id: result.body.id! };
}

export interface CreateDetectedIssueInput {
  patientId: string;
  ruleId: string;
  ruleVersion: string;
  severity: "high" | "moderate" | "low";
  summary: string;
  medicationRequestId?: string;
  implicatedReferences?: string[];
}

export async function createDetectedIssue(input: CreateDetectedIssueInput): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  const implicated: fhir4.Reference[] = [
    ...(input.medicationRequestId ? [{ reference: `MedicationRequest/${input.medicationRequestId}` }] : []),
    ...(input.implicatedReferences ?? []).map(ref => ({ reference: ref })),
  ];

  const detectedIssue: fhir4.DetectedIssue = {
    resourceType: "DetectedIssue",
    status: "preliminary",
    code: { text: input.summary, coding: [{ code: input.ruleId, display: input.summary }] },
    severity: input.severity,
    patient: { reference: `Patient/${input.patientId}` },
    identifiedDateTime: new Date().toISOString(),
    implicated,
    detail: `rule:${input.ruleId} version:${input.ruleVersion}`,
  };

  const result = await createFhirResource<fhir4.DetectedIssue | fhir4.OperationOutcome>("DetectedIssue", detectedIssue);
  if (result.status !== 201 || isOperationOutcome(result.body)) {
    return { ok: false, status: result.status, error: "Unable to create the detected issue." };
  }
  return { ok: true, id: result.body.id! };
}

export interface ResolveDetectedIssueInput {
  id: string;
  action: "modify" | "cancel" | "continue" | "create-task";
  reason: string;
  actorDisplay: string;
}

export async function resolveDetectedIssue(input: ResolveDetectedIssueInput): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const current = await readFhirResource<fhir4.DetectedIssue | fhir4.OperationOutcome>("DetectedIssue", input.id);
  if (current.status !== 200 || isOperationOutcome(current.body)) return { ok: false, status: current.status, error: "Detected issue not found." };
  if (current.body.identifier?.some(identifier => identifier.system === COPD_FINDING_SYSTEM)) {
    if (input.action !== "continue") return { ok: false, status: 400, error: "Document the COPD review with a reason. Medication changes require their separate prescribing workflow." };
    try { await resolveCopdIssue(current.body, input.reason, input.actorDisplay); return { ok: true }; }
    catch (error) { return { ok: false, status: 409, error: error instanceof Error ? error.message : "Unable to resolve COPD finding." }; }
  }

  const actionLabels: Record<ResolveDetectedIssueInput["action"], string> = {
    modify: "Draft modified",
    cancel: "Draft cancelled",
    continue: "Continued with documented reason",
    "create-task": "Monitoring task created",
  };

  const updated: fhir4.DetectedIssue = {
    ...current.body,
    status: "final",
    mitigation: [
      ...(current.body.mitigation ?? []),
      { action: { text: actionLabels[input.action] }, date: new Date().toISOString(), author: { display: input.actorDisplay } },
    ],
    detail: `${current.body.detail ?? ""} | override-reason:${input.reason}`,
  };

  const result = await updateFhirResource<fhir4.DetectedIssue | fhir4.OperationOutcome>("DetectedIssue", input.id, updated);
  if (isOperationOutcome(result.body)) return { ok: false, status: result.status, error: "Unable to resolve the detected issue." };

  const medicationRequestId = current.body.implicated?.find(r => r.reference?.includes("MedicationRequest"))?.reference?.split("/").pop();

  if (input.action === "cancel" && medicationRequestId) {
    await stopMedicationRequest(medicationRequestId, `Cancelled after safety review: ${input.reason}`, input.actorDisplay);
  }
  if (input.action === "create-task" && medicationRequestId) {
    await createMedicationMonitoringTask(medicationRequestId, current.body.patient?.reference?.split("/").pop() ?? "", input.reason, input.actorDisplay);
  }

  return { ok: true };
}

export async function createMedicationMonitoringTask(
  medicationRequestId: string,
  patientId: string,
  reason: string,
  actorDisplay: string,
): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  // Duplicate-prevention: search existing open tasks focused on this MedicationRequest before creating another.
  const existing = await searchFhirResource<fhir4.Bundle>("Task", `patient=${encodeURIComponent(patientId)}`);
  const openDuplicate = (existing.body?.entry ?? [])
    .map(e => e.resource)
    .filter((r): r is fhir4.Task => !!r && r.resourceType === "Task")
    .find(
      t =>
        t.focus?.reference === `MedicationRequest/${medicationRequestId}` &&
        t.description === MONITORING_TASK_DESCRIPTION &&
        t.status !== "completed" &&
        t.status !== "cancelled",
    );
  if (openDuplicate) return { ok: true, id: openDuplicate.id! };

  const task: fhir4.Task = {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    description: MONITORING_TASK_DESCRIPTION,
    priority: "routine",
    focus: { reference: `MedicationRequest/${medicationRequestId}` },
    for: { reference: `Patient/${patientId}` },
    owner: { display: "Clinician review pool" },
    authoredOn: new Date().toISOString(),
    note: [annotation(reason, actorDisplay)],
  };

  const result = await createFhirResource<fhir4.Task | fhir4.OperationOutcome>("Task", task);
  if (result.status !== 201 || isOperationOutcome(result.body)) return { ok: false, status: result.status, error: "Unable to create monitoring task." };
  return { ok: true, id: result.body.id! };
}

export { NONADHERENCE_KEYWORDS as MEDICATION_NONADHERENCE_KEYWORDS, RULESET_VERSION as MEDICATION_RULESET_VERSION };
