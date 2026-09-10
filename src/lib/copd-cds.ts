import { createHash } from "node:crypto";
import { referencesPatient } from "./formatters";

export const COPD_CDS_SYSTEM = "https://waypoint.example/fhir/CodeSystem/copd-cds";
export const COPD_FINDING_SYSTEM = "https://waypoint.example/fhir/identifier/copd-cds";
export const COPD_DEMO_SYSTEM = "https://waypoint.example/fhir/CodeSystem/copd-demo";
export const COPD_RULE_VERSION = "2026-09-09.2";
export const COPD_HOME_HEALTH_QUESTIONNAIRE = "https://waypoint.example/fhir/Questionnaire/copd-home-health-subset";
export type CopdCategory = "MEDICATION_RECONCILIATION" | "MEDICATION_SAFETY" | "HOME_HEALTH_REVIEW" | "POST_DISCHARGE_FOLLOWUP" | "WORSENING_COPD_PATTERN" | "RESCUE_MEDICATION_USE" | "EXACERBATION_RISK" | "PULMONARY_REHAB_GAP" | "OXYGEN_REASSESSMENT" | "CARE_TRANSITION_GAP";

/**
 * Demonstration configuration, not a validated drug database. Only nonselective agents are listed:
 * cardioselective beta-1 blockers are deliberately absent and must never be flagged by this rule.
 */
export const NONSELECTIVE_BETA_BLOCKERS = ["propranolol", "nadolol", "timolol", "pindolol", "sotalol"] as const;
export const BETA_AGONIST_RESCUE_MEDICATIONS = ["albuterol", "salbutamol", "levalbuterol", "terbutaline"] as const;
export interface CopdFinding {
  id: string;
  patientId: string;
  ruleId: string;
  category: CopdCategory;
  severity: "warning" | "critical";
  title: string;
  /** Fixed clinician-facing description of the rule; never derived from patient data or an LLM. */
  detail: string;
  explanation: string;
  evidence: string[];
  sourceResources: string[];
  recommendedWorkflow: string;
  linkLabel: string;
  /** Medication identities implicated by a reconciliation finding, so order-select/order-sign can scope to the drafted medication. */
  medicationKeys?: string[];
  persistent: boolean;
  detectedIssueId?: string;
}
export interface CopdConfig {
  recentDays: number;
  signalDays: number;
  followupWindowDays: number;
  rehabReviewEnabled: boolean;
  homeHealthReviewEnabled: boolean;
  rescueUseReviewEnabled: boolean;
  betaBlockerReviewEnabled: boolean;
  schedulingAuthoritative: boolean;
  rehabilitationAuthoritative: boolean;
  oxygenAuthoritative: boolean;
}
// Deployment policy, not a validated predictive model. No medication changes are recommended.
export const DEFAULT_COPD_CONFIG: CopdConfig = { recentDays: 90, signalDays: 30, followupWindowDays: 30, rehabReviewEnabled: true, homeHealthReviewEnabled: true, rescueUseReviewEnabled: true, betaBlockerReviewEnabled: true, schedulingAuthoritative: false, rehabilitationAuthoritative: false, oxygenAuthoritative: false };

/** Card wording is fixed per rule. The deterministic engine decides whether a rule fires; nothing here is generated. */
interface RulePresentation { title: string; detail: string; workflow: string; linkLabel: string }
const NEEDS_ATTENTION = "#copd-needs-attention";
export const COPD_RULE_PRESENTATION: Record<string, RulePresentation> = {
  "home-health-findings-review": { title: "New post-discharge home-health findings require review", detail: "Home-health findings have been documented after the patient's recent COPD transition. Review respiratory status, medications, and follow-up needs.", workflow: NEEDS_ATTENTION, linkLabel: "Open Waypoint" },
  "medication-reconciliation": { title: "COPD medication discrepancy requires review", detail: "The medication list and patient-reported use do not currently match.", workflow: "/medications", linkLabel: "Review medication reconciliation" },
  "unlisted-home-medication": { title: "COPD medication discrepancy requires review", detail: "A reported home medication is not matched to an active prescription in the available medication list.", workflow: "/medications", linkLabel: "Review medication reconciliation" },
  "nonselective-beta-blocker-copd-review": { title: "Medication requires COPD-specific review", detail: "A nonselective beta-blocker is documented in a patient with COPD. Review the indication, respiratory status, and medication regimen.", workflow: "/medications", linkLabel: "Review medication reconciliation" },
  "increased-rescue-use": { title: "Increased rescue medication use reported", detail: "Recent patient-reported rescue medication use is higher than the documented baseline. Review symptoms and current COPD management.", workflow: NEEDS_ATTENTION, linkLabel: "Open Waypoint" },
  "worsening-pattern": { title: "Worsening COPD pattern identified", detail: "Confirmed respiratory findings changed after a recent COPD exacerbation. This does not diagnose a current exacerbation.", workflow: NEEDS_ATTENTION, linkLabel: "Open Waypoint" },
  "post-discharge-followup": { title: "COPD follow-up may need attention", detail: "No qualifying post-discharge follow-up is currently documented.", workflow: "/care-coordination", linkLabel: "Review care transitions" },
  "pulmonary-rehab-gap": { title: "Pulmonary rehabilitation referral not documented", detail: "No pulmonary rehabilitation referral is currently documented in the available record.", workflow: "/care-coordination", linkLabel: "Review pulmonary rehab" },
  "oxygen-reassessment": { title: "Oxygen therapy reassessment is due", detail: "A documented oxygen reassessment task is past due and no completed reassessment is visible.", workflow: NEEDS_ATTENTION, linkLabel: "Open Waypoint" },
  "care-transition-gap": { title: "COPD post-discharge care needs review", detail: "More than one post-discharge care-transition gap is currently documented.", workflow: "/care-coordination", linkLabel: "Review care transitions" },
};
export interface CopdInput { patientId: string; resources: fhir4.Resource[]; complete: Record<string, boolean>; now: string; config?: Partial<CopdConfig> }
export interface CopdResult { patientId: string; ruleVersion: string; findings: CopdFinding[]; context: { recentExacerbations: number; exacerbationsLastYear: number }; insufficientData: string[]; medicationSafety: "disabled-no-validated-source" }
export const patientIdValid = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9.-]{1,64}$/.test(id);
const DAY = 86400000;
const ref = (resource: fhir4.Resource) => `${resource.resourceType}/${resource.id}`;
const coded = (concept: fhir4.CodeableConcept | undefined, system: string, code: string) => concept?.coding?.some(coding => coding.system === system && coding.code === code) ?? false;
const local = (concept: fhir4.CodeableConcept | undefined, code: string) => coded(concept, COPD_CDS_SYSTEM, code) || coded(concept, COPD_DEMO_SYSTEM, code);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const workflowPath = (patientId: string, suffix: string) => `/patients/${encodeURIComponent(patientId)}${suffix}`;
export function hasCopdCondition(condition: fhir4.Condition) {
  return !condition.verificationStatus?.coding?.some(code => ["refuted", "entered-in-error", "unconfirmed", "provisional", "differential"].includes(code.code ?? "")) && !!condition.code?.coding?.some(code => (code.system === "http://hl7.org/fhir/sid/icd-10-cm" && /^J44(?:\.|$)/.test(code.code ?? "")) || (code.system === "http://snomed.info/sct" && code.code === "13645005"));
}
function medicationKey(resource: fhir4.MedicationRequest | fhir4.MedicationStatement) {
  if (resource.medicationReference?.reference) return resource.medicationReference.reference;
  const coding = resource.medicationCodeableConcept?.coding?.find(code => code.system && code.code);
  if (coding) return `${coding.system}|${coding.code}`;
  return resource.medicationCodeableConcept?.text?.trim().toLowerCase() || undefined;
}
export { medicationKey as copdMedicationKey };
function medicationName(resource: fhir4.MedicationRequest | fhir4.MedicationStatement) {
  return resource.medicationCodeableConcept?.text ?? resource.medicationCodeableConcept?.coding?.[0]?.display ?? resource.medicationReference?.display ?? "Medication";
}
function medicationMatches(order: fhir4.MedicationRequest, statement: fhir4.MedicationStatement) {
  if (statement.basedOn?.length) return statement.basedOn.some(reference => reference.reference === ref(order));
  const key = medicationKey(order);
  return !!key && key === medicationKey(statement);
}
function differentStructuredDose(order: fhir4.MedicationRequest, statement: fhir4.MedicationStatement) {
  const a = order.dosageInstruction?.[0];
  const b = statement.dosage?.[0];
  if (!a || !b) return false;
  const aq = a.doseAndRate?.[0]?.doseQuantity;
  const bq = b.doseAndRate?.[0]?.doseQuantity;
  const dose = aq?.value !== undefined && bq?.value !== undefined && !!(aq.code ?? aq.unit) && (aq.code ?? aq.unit) === (bq.code ?? bq.unit) && aq.value !== bq.value;
  const at = a.timing?.repeat; const bt = b.timing?.repeat;
  const frequency = at?.frequency !== undefined && bt?.frequency !== undefined && at.period !== undefined && bt.period !== undefined && !!at.periodUnit && at.periodUnit === bt.periodUnit && at.period === bt.period && at.frequency !== bt.frequency;
  return dose || frequency;
}
export function evaluateCopd(input: CopdInput): CopdResult {
  if (!patientIdValid(input.patientId) || !Number.isFinite(Date.parse(input.now))) throw new Error("Valid patient identity and evaluation time are required.");
  const config = { ...DEFAULT_COPD_CONFIG, ...input.config };
  for (const value of [config.recentDays, config.signalDays, config.followupWindowDays]) if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid COPD time window configuration.");
  const now = Date.parse(input.now);
  const recent = (date: string | undefined, days: number) => !!date && Number.isFinite(Date.parse(date)) && now - Date.parse(date) >= 0 && now - Date.parse(date) <= days * DAY;
  const inWindow = (date: string | undefined, start: string, days: number) => !!date && Date.parse(date) >= Date.parse(start) && Date.parse(date) <= Date.parse(start) + days * DAY;
  function list<T extends fhir4.Resource>(type: T["resourceType"]): T[] {
    return input.resources.filter(resource => {
      if (resource.resourceType !== type || !resource.id) return false;
      const item = resource as unknown as { subject?: fhir4.Reference; patient?: fhir4.Reference; for?: fhir4.Reference; participant?: fhir4.AppointmentParticipant[] };
      return resource.resourceType === "Appointment" ? !!item.participant?.some(person => referencesPatient(person.actor, input.patientId)) : referencesPatient(item.subject ?? item.patient ?? item.for, input.patientId);
    }) as T[];
  }
  const result: CopdResult = { patientId: input.patientId, ruleVersion: COPD_RULE_VERSION, findings: [], context: { recentExacerbations: 0, exacerbationsLastYear: 0 }, insufficientData: [], medicationSafety: "disabled-no-validated-source" };
  const conditions = list<fhir4.Condition>("Condition").filter(hasCopdCondition);
  if (!conditions.length) { if (!input.complete.Condition) result.insufficientData.push("COPD diagnosis data unavailable."); return result; }
  const issues = list<fhir4.DetectedIssue>("DetectedIssue");
  const tasks = list<fhir4.Task>("Task");
  const encounters = list<fhir4.Encounter>("Encounter");
  const observations = list<fhir4.Observation>("Observation").filter(item => ["final", "amended", "corrected"].includes(item.status));
  const requests = list<fhir4.MedicationRequest>("MedicationRequest").filter(item => item.status === "active" && item.intent === "order" && !item.doNotPerform);
  const statements = list<fhir4.MedicationStatement>("MedicationStatement").filter(item => ["active", "not-taken", "stopped", "on-hold"].includes(item.status) && !!item.informationSource && recent(item.dateAsserted, config.recentDays) && !item.meta?.tag?.some(tag => ["candidate", "unconfirmed"].includes(tag.code ?? "")));
  function add(ruleId: string, category: CopdCategory, evidence: string[], sources: fhir4.Resource[], persistent = true) {
    const presentation = COPD_RULE_PRESENTATION[ruleId];
    if (!presentation) throw new Error(`Unknown COPD rule: ${ruleId}`);
    const sourceResources = [...new Set(sources.map(ref))].sort();
    const id = hash([input.patientId, COPD_RULE_VERSION, ruleId, sourceResources, evidence]);
    const existing = issues.find(issue => issue.identifier?.some(identifier => identifier.system === COPD_FINDING_SYSTEM && identifier.value === id));
    // FHIR final is not itself a resolution. The existing workflow records mitigation.
    if (existing?.mitigation?.length) return;
    const medicationKeys = [...new Set(sources.filter((source): source is fhir4.MedicationRequest | fhir4.MedicationStatement => source.resourceType === "MedicationRequest" || source.resourceType === "MedicationStatement").map(medicationKey).filter((key): key is string => !!key))].sort();
    result.findings.push({ id, patientId: input.patientId, ruleId, category, title: presentation.title, detail: presentation.detail, evidence, sourceResources, explanation: evidence.join(" "), severity: "warning", persistent, recommendedWorkflow: workflowPath(input.patientId, presentation.workflow), linkLabel: presentation.linkLabel, ...(medicationKeys.length ? { medicationKeys } : {}), ...(existing?.id ? { detectedIssueId: existing.id } : {}) });
  }
  const exac = (concept: fhir4.CodeableConcept | undefined) => coded(concept, "http://hl7.org/fhir/sid/icd-10-cm", "J44.1") || local(concept, "copd-exacerbation");
  const exacEncounters = encounters.filter(encounter => encounter.status === "finished" && (encounter.reasonCode?.some(exac) || encounter.diagnosis?.some(diagnosis => conditions.some(condition => ref(condition) === diagnosis.condition.reference && exac(condition.code)))));
  const severe = exacEncounters.filter(encounter => encounter.class.code === "IMP");
  const historical = severe.filter(encounter => recent(encounter.period?.end, 365));
  const moderate = conditions.filter(condition => exac(condition.code) && ["moderate", "severe"].includes(condition.severity?.text?.toLowerCase() ?? "") && !condition.encounter?.reference && recent(condition.onsetDateTime, 365));
  result.context.exacerbationsLastYear = historical.length + moderate.length;
  const recentEvents: fhir4.Resource[] = [...severe.filter(encounter => recent(encounter.period?.end, config.recentDays)), ...moderate.filter(condition => recent(condition.onsetDateTime, config.recentDays))];
  result.context.recentExacerbations = recentEvents.length;
  const discharge = severe.filter(encounter => recent(encounter.period?.end, config.recentDays)).sort((a, b) => b.period!.end!.localeCompare(a.period!.end!))[0];

  if (input.complete.MedicationRequest && input.complete.MedicationStatement && input.complete.DetectedIssue) {
    for (const order of requests) {
      const statement = statements.filter(statement => medicationMatches(order, statement)).sort((a, b) => (b.dateAsserted ?? "").localeCompare(a.dateAsserted ?? "") || (b.meta?.lastUpdated ?? "").localeCompare(a.meta?.lastUpdated ?? ""))[0];
      if (!statement) continue;
      const reportedUse = statement.extension?.find(extension => extension.url === "https://waypoint.example/fhir/StructureDefinition/reported-medication-use")?.valueCode;
      const mismatch = differentStructuredDose(order, statement) || reportedUse === "different";
      if (["not-taken", "stopped", "on-hold"].includes(statement.status) || mismatch || reportedUse === "unavailable") add("medication-reconciliation", "MEDICATION_RECONCILIATION", [`${medicationName(order)} is actively prescribed; confirmed reported use is ${reportedUse ?? statement.status}${mismatch ? " with different reported dose/frequency or use" : ""}.`, ...(statement.note?.map(note => note.text) ?? [])], [order, statement]);
    }
    const latest = new Map<string, fhir4.MedicationStatement>();
    for (const statement of [...statements].sort((a, b) => (a.dateAsserted ?? "").localeCompare(b.dateAsserted ?? ""))) { const key = medicationKey(statement); if (key) latest.set(key, statement); }
    for (const statement of latest.values()) if (statement.status === "active" && !requests.some(order => medicationMatches(order, statement))) add("unlisted-home-medication", "MEDICATION_RECONCILIATION", [`Confirmed use of ${medicationName(statement)} is not matched to an active prescription in the available medication list.`], [statement]);

    // Drug-disease review, not a contraindication: the presence of a nonselective agent in COPD is what a clinician is asked to look at.
    if (config.betaBlockerReviewEnabled) {
      const nonselective = [...requests, ...statements.filter(statement => statement.status === "active")].filter(resource => NONSELECTIVE_BETA_BLOCKERS.some(name => medicationName(resource).toLowerCase().includes(name)));
      const rescue = [...requests, ...statements.filter(statement => statement.status === "active")].filter(resource => BETA_AGONIST_RESCUE_MEDICATIONS.some(name => medicationName(resource).toLowerCase().includes(name)));
      if (nonselective.length) add("nonselective-beta-blocker-copd-review", "MEDICATION_SAFETY", [`${[...new Set(nonselective.map(medicationName))].join(", ")} is documented for a patient with COPD.`, ...(rescue.length ? [`Beta-agonist rescue therapy (${[...new Set(rescue.map(medicationName))].join(", ")}) is also documented.`] : []), "Review the indication, respiratory status, and medication regimen. This is not a contraindication and no medication change is recommended here."], [...nonselective, ...rescue]);
    }
  } else result.insufficientData.push("Medication or issue history is incomplete; reconciliation CDS withheld.");

  const qrs = list<fhir4.QuestionnaireResponse>("QuestionnaireResponse").filter(item => item.questionnaire === COPD_HOME_HEALTH_QUESTIONNAIRE && ["completed", "amended"].includes(item.status) && !!item.author);
  const recentQrs = qrs.filter(item => recent(item.authored, config.signalDays));
  function signal(code: string, linkId: string, expected: string[]): fhir4.Resource | undefined {
    const observation = observations.filter(item => local(item.code, code) && recent(item.effectiveDateTime, config.signalDays)).sort((a, b) => b.effectiveDateTime!.localeCompare(a.effectiveDateTime!))[0];
    if (observation) return observation.valueBoolean === true ? observation : undefined;
    const qr = recentQrs.filter(item => item.item?.some(answer => answer.linkId === linkId)).sort((a, b) => b.authored!.localeCompare(a.authored!))[0];
    const value = qr?.item?.find(item => item.linkId === linkId)?.answer?.[0]?.valueString?.trim().toLowerCase();
    return value && expected.includes(value) ? qr : undefined;
  }
  const rescue = signal("increased-rescue-use", "rescue-inhaler", ["increased", "increased use"]);
  const dyspnea = signal("worsening-dyspnea", "breathing-baseline", ["worse", "worsening"]);
  const increasedOxygen = signal("increased-oxygen-requirement", "oxygen-change", ["increased"]);
  const signals = [rescue, dyspnea, increasedOxygen].filter((item): item is fhir4.Resource => !!item);
  const worsening = !!(input.complete.DetectedIssue && recentEvents.length && signals.length);
  if (worsening) add("worsening-pattern", "WORSENING_COPD_PATTERN", ["Recent moderate/severe COPD exacerbation is documented.", ...(rescue ? ["Confirmed increase in rescue inhaler use."] : []), ...(dyspnea ? ["Confirmed worsening dyspnea compared with baseline."] : []), ...(increasedOxygen ? ["Confirmed increase in oxygen requirement."] : []), "Clinician review is needed; this does not diagnose a current exacerbation."], [...recentEvents, ...signals], false);
  // Rule 3 stands alone only when the composite worsening rule did not already describe the same evidence.
  else if (config.rescueUseReviewEnabled && rescue && input.complete.DetectedIssue) add("increased-rescue-use", "RESCUE_MEDICATION_USE", ["Confirmed rescue medication use is higher than the documented baseline.", "This does not by itself establish a current exacerbation."], [rescue], false);

  if (discharge && input.complete.DetectedIssue) {
    const start = discharge.period!.end!;
    const appointments = list<fhir4.Appointment>("Appointment");

    // Rule 1: nurse-authored home-health findings exist after the transition and no ambulatory review has happened since.
    if (config.homeHealthReviewEnabled) {
      const postDischargeQrs = qrs.filter(item => !!item.authored && Date.parse(item.authored) >= Date.parse(start) && Date.parse(item.authored) <= now).sort((a, b) => b.authored!.localeCompare(a.authored!));
      const newest = postDischargeQrs[0];
      if (newest) {
        if (!input.complete.QuestionnaireResponse || !input.complete.Encounter) result.insufficientData.push("Home-health and encounter coverage is insufficient to confirm an outstanding review.");
        else {
          const reviewed = encounters.some(encounter => encounter.class.code === "AMB" && encounter.status === "finished" && !!encounter.period?.start && Date.parse(encounter.period.start) >= Date.parse(newest.authored!) && Date.parse(encounter.period.start) <= now) || tasks.some(task => local(task.code, "home-health-findings-review") && task.status === "completed");
          if (!reviewed) add("home-health-findings-review", "HOME_HEALTH_REVIEW", [`Home-health findings were documented ${newest.authored!.slice(0, 10)} after the COPD transition that ended ${start.slice(0, 10)}.`, "No ambulatory review of those findings is visible in the available record."], [discharge, newest]);
        }
      }
    }

    const followupCode = (concept: fhir4.CodeableConcept | undefined) => local(concept, "copd-follow-up") || local(concept, "pulmonology-follow-up") || local(concept, "primary-care-follow-up");
    const followup = appointments.some(appointment => ["booked", "arrived", "fulfilled", "checked-in"].includes(appointment.status) && inWindow(appointment.start, start, config.followupWindowDays) && (Date.parse(appointment.start!) >= now || appointment.status === "fulfilled") && [...(appointment.serviceType ?? []), ...(appointment.reasonCode ?? [])].some(followupCode)) || encounters.some(encounter => encounter.class.code === "AMB" && encounter.status === "finished" && inWindow(encounter.period?.start, start, config.followupWindowDays) && Date.parse(encounter.period!.start!) <= now && [...(encounter.type ?? []), ...(encounter.reasonCode ?? [])].some(followupCode));
    if (!config.schedulingAuthoritative || !input.complete.Appointment || !input.complete.Encounter) result.insufficientData.push("Scheduling coverage is insufficient to determine early COPD follow-up.");
    else if (!followup) add("post-discharge-followup", "POST_DISCHARGE_FOLLOWUP", [`COPD hospitalization ended ${start.slice(0, 10)}.`, `No completed or scheduled appropriate follow-up is visible within the configured ${config.followupWindowDays}-day window in the available scheduling data.`], [discharge]);

    const services = list<fhir4.ServiceRequest>("ServiceRequest");
    const plans = list<fhir4.CarePlan>("CarePlan");
    const rehabCode = (concept: fhir4.CodeableConcept | undefined) => local(concept, "pulmonary-rehabilitation");
    const rehabilitation = services.some(request => ["active", "on-hold", "completed"].includes(request.status) && rehabCode(request.code) && (!!request.authoredOn && Date.parse(request.authoredOn) >= Date.parse(start) || request.status === "active")) || plans.some(plan => ["active", "completed", "on-hold"].includes(plan.status) && plan.activity?.some(activity => rehabCode(activity.detail?.code)) && (plan.status === "active" || !!plan.period?.end && Date.parse(plan.period.end) >= Date.parse(start))) || observations.some(observation => local(observation.code, "pulmonary-rehab-assessment") && !!observation.effectiveDateTime && Date.parse(observation.effectiveDateTime) >= Date.parse(start) && Date.parse(observation.effectiveDateTime) <= now) || appointments.some(appointment => ["booked", "arrived", "fulfilled", "checked-in"].includes(appointment.status) && appointment.serviceType?.some(rehabCode) && !!appointment.start && Date.parse(appointment.start) >= Date.parse(start));
    if (config.rehabReviewEnabled) {
      if (!config.rehabilitationAuthoritative || !["ServiceRequest", "CarePlan", "Observation", "Appointment"].every(type => input.complete[type])) result.insufficientData.push("Pulmonary rehabilitation data coverage is insufficient to confirm a gap.");
      else if (!rehabilitation) add("pulmonary-rehab-gap", "PULMONARY_REHAB_GAP", ["Recent COPD hospitalization is documented; no current pulmonary rehabilitation referral, assessment, appointment, or care plan is visible in the configured source."], [discharge]);
    }
    const oxygen = observations.filter(item => local(item.code, "oxygen-use") && recent(item.effectiveDateTime, config.recentDays)).sort((a, b) => b.effectiveDateTime!.localeCompare(a.effectiveDateTime!))[0];
    const usingOxygen = oxygen?.valueBoolean === true || ["nocturnal", "continuous", "with exertion"].includes(oxygen?.valueString?.toLowerCase() ?? "");
    const due = tasks.find(task => local(task.code, "oxygen-reassessment") && !["completed", "cancelled", "entered-in-error", "failed"].includes(task.status) && !!task.executionPeriod?.end && Date.parse(task.executionPeriod.end) >= Date.parse(start) && Date.parse(task.executionPeriod.end) <= now);
    const reassessed = observations.some(item => local(item.code, "oxygen-reassessment") && !!item.effectiveDateTime && Date.parse(item.effectiveDateTime) >= Date.parse(start) && Date.parse(item.effectiveDateTime) <= now) || tasks.some(task => local(task.code, "oxygen-reassessment") && task.status === "completed" && !!task.executionPeriod?.end && Date.parse(task.executionPeriod.end) >= Date.parse(start) && Date.parse(task.executionPeriod.end) <= now);
    if (usingOxygen && due) {
      if (!config.oxygenAuthoritative || !input.complete.Observation || !input.complete.Task) result.insufficientData.push("Oxygen reassessment coverage is insufficient to confirm a gap.");
      else if (!reassessed) add("oxygen-reassessment", "OXYGEN_REASSESSMENT", ["Supplemental oxygen is documented after a recent COPD hospitalization.", `The documented reassessment task was due ${due.executionPeriod!.end!.slice(0, 10)}; no completed reassessment is visible.`], [discharge, oxygen!, due]);
    }
  }
  return result;
}

export function prioritizedFindings(findings: CopdFinding[], maximum = 3): CopdFinding[] {
  const rank: Partial<Record<CopdCategory, number>> = { MEDICATION_SAFETY: 0, MEDICATION_RECONCILIATION: 1, WORSENING_COPD_PATTERN: 2, RESCUE_MEDICATION_USE: 3, HOME_HEALTH_REVIEW: 4, POST_DISCHARGE_FOLLOWUP: 5, PULMONARY_REHAB_GAP: 6, OXYGEN_REASSESSMENT: 7 };
  const deduped = [...new Map(findings.map(finding => [finding.id, finding])).values()];
  // Only one medication-reconciliation card: several discrepant medications are one problem for the clinician.
  const reconciliation = deduped.filter(finding => finding.category === "MEDICATION_RECONCILIATION").sort((a, b) => a.id.localeCompare(b.id));
  const collapsed = reconciliation.length > 1 ? [...deduped.filter(finding => finding.category !== "MEDICATION_RECONCILIATION"), { ...reconciliation[0]!, id: hash(reconciliation.map(finding => finding.id).sort()), explanation: reconciliation.map(finding => finding.explanation).join("\n\n"), evidence: reconciliation.flatMap(finding => finding.evidence), sourceResources: [...new Set(reconciliation.flatMap(finding => finding.sourceResources))], persistent: false }] : deduped;
  const ordered = collapsed.sort((a, b) => (a.severity === "critical" ? -1 : rank[a.category] ?? 8) - (b.severity === "critical" ? -1 : rank[b.category] ?? 8) || a.id.localeCompare(b.id));
  const transitions = ordered.filter(finding => ["POST_DISCHARGE_FOLLOWUP", "PULMONARY_REHAB_GAP", "OXYGEN_REASSESSMENT"].includes(finding.category));
  if (transitions.length > 1) {
    const merged = COPD_RULE_PRESENTATION["care-transition-gap"]!;
    return [...ordered.filter(finding => !transitions.includes(finding)), { ...transitions[0]!, id: hash(transitions.map(finding => finding.id).sort()), ruleId: "care-transition-gap", category: "CARE_TRANSITION_GAP" as const, title: merged.title, detail: merged.detail, linkLabel: merged.linkLabel, recommendedWorkflow: workflowPath(transitions[0]!.patientId, merged.workflow), explanation: transitions.map(finding => finding.explanation).join("\n\n"), evidence: transitions.flatMap(finding => finding.evidence), sourceResources: [...new Set(transitions.flatMap(finding => finding.sourceResources))], persistent: false }].slice(0, maximum);
  }
  return ordered.slice(0, maximum);
}

export function copdCards(result: CopdResult, publicUrl: string, smartLaunchUrl?: string) {
  const base = new URL(publicUrl);
  if (!["https:", "http:"].includes(base.protocol)) throw new Error("Invalid Waypoint public URL.");
  if (smartLaunchUrl && !["https:", "http:"].includes(new URL(smartLaunchUrl).protocol)) throw new Error("Invalid SMART launch URL.");
  return prioritizedFindings(result.findings).map(finding => ({
    uuid: `${finding.id.slice(0, 8)}-${finding.id.slice(8, 12)}-4${finding.id.slice(13, 16)}-8${finding.id.slice(17, 20)}-${finding.id.slice(20, 32)}`,
    summary: finding.title,
    indicator: finding.severity,
    detail: `${finding.detail}\n\n${finding.explanation}\n\nEvidence: ${finding.sourceResources.join(", ")}`,
    source: { label: "Waypoint COPD decision support" },
    links: [smartLaunchUrl
      // SMART launch carries patient context through the EHR; the workflow path travels in appContext, never as a query parameter.
      ? { label: finding.linkLabel, type: "smart", url: smartLaunchUrl, appContext: JSON.stringify({ patientId: result.patientId, path: finding.recommendedWorkflow }) }
      : { label: finding.linkLabel, type: "absolute", url: new URL(finding.recommendedWorkflow, base).toString() }],
  }));
}
