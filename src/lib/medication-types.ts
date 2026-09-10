/** Shared between the server (medications.ts, cds-hooks.ts) and the client — no DOM/Bun-specific APIs here. */
import type { MedicationCategoryGroup, CdsRuleSeverity } from "./medication-config";
import type { CopdMedicationClass, MedicationTherapyRole } from "./copd-medication-catalog";

export type MonitoringStatus = "current" | "overdue" | "unavailable" | "insufficient-information";

export interface MonitoringStatusView {
  label: string;
  status: MonitoringStatus;
  lastDate?: string;
}

export interface MedicationRegimenItem {
  id: string;
  medicationText: string;
  medicationSystem?: string;
  medicationCode?: string;
  categoryId?: string;
  categoryLabel?: string;
  categoryGroup: MedicationCategoryGroup;
  status: string;
  intent: string;
  dose?: string;
  route?: string;
  frequency?: string;
  startDate?: string;
  expectedEndDate?: string;
  indication?: string;
  treatmentPhase?: string;
  orderingClinician?: string;
  patientReportedUseText?: string;
  patientReportedUseDate?: string;
  lastReconciliationDate?: string;
  monitoring: MonitoringStatusView[];
  priorPrescriptionId?: string;
  note?: string;
  genericName?: string;
  brandName?: string;
  medicationClass?: CopdMedicationClass;
  therapyRole?: MedicationTherapyRole;
  reconciliationStatus?: "reconciled" | "needs-review" | "not-reviewed";
  discrepancyType?: string;
  openIssueCount?: number;
  openTaskCount?: number;
}

export interface ReconciliationIssueView {
  medicationRequestId: string;
  medicationText: string;
  orderedSummary: string;
  reportedSummary: string;
  statementId?: string;
}

export interface DetectedIssueView {
  id: string;
  ruleId?: string;
  ruleVersion?: string;
  severity: CdsRuleSeverity | "unknown";
  summary?: string;
  status: string;
  implicatedMedicationRequestIds: string[];
  identifiedDateTime?: string;
  mitigationAction?: string;
  mitigationAuthor?: string;
  overrideReason?: string;
}

export interface MedicationStatementView {
  id: string;
  medicationText: string;
  status: string;
  dose?: string;
  dateAsserted?: string;
  note?: string;
}

export interface MedicationAdministrationView {
  id: string;
  medicationText: string;
  status: string;
  effectiveDate?: string;
  dose?: string;
}

export interface AllergyView {
  id: string;
  text: string;
  criticality?: string;
  status?: string;
}

export interface SymptomAssessmentSummary {
  id: string;
  authored?: string;
  status: string;
  reportedSymptomCount: number;
  requiresReview: boolean;
}

export interface MedicationSafetyCounts {
  conflicts: number;
  monitoringGaps: number;
  reconciliationIssues: number;
  symptomsRequiringReview: number;
  openTasks: number;
}

export interface MedicationPatientState {
  patientId: string;
  cohortMember: boolean;
  safetyCounts: MedicationSafetyCounts;
  regimenByGroup: Record<MedicationCategoryGroup, MedicationRegimenItem[]>;
  inactiveOrders: MedicationRegimenItem[];
  reconciliationIssues: ReconciliationIssueView[];
  detectedIssues: DetectedIssueView[];
  medicationStatements: MedicationStatementView[];
  medicationAdministrations: MedicationAdministrationView[];
  allergies: AllergyView[];
  assessments: SymptomAssessmentSummary[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// CDS Hooks (minimal subset of the spec needed here)
// ---------------------------------------------------------------------------

export interface CdsHooksCard {
  summary: string;
  indicator: "info" | "warning" | "critical";
  detail?: string;
  source: { label: string };
  suggestions?: { label: string; uuid?: string }[];
  links?: { label: string; url: string; type: "absolute" | "smart" }[];
  selectionBehavior?: "at-most-one";
  overrideReasons?: { code: string; system?: string; display: string }[];
}

export interface CdsHooksResponse {
  cards: CdsHooksCard[];
}
