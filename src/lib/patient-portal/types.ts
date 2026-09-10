export type PatientLabCategory =
  | "respiratory"
  | "oxygen"
  | "blood-count"
  | "other";

export type PatientLabTrend = "improving" | "worsening" | "stable" | "changing" | "insufficient-data" | "not-applicable";
export type PatientLabStatus =
  | "within-reported-range"
  | "outside-reported-range"
  | "awaiting-review"
  | "reviewed"
  | "range-unavailable"
  | "insufficient-data";

export interface PatientIdentity {
  firstName: string;
  displayName: string;
  pronouns?: string;
  synthetic: boolean;
}

export interface PatientFriendlyLabResult {
  id: string;
  fhirReference: string;
  category: PatientLabCategory;
  name: string;
  plainLanguageName: string;
  value: number | string | null;
  unit: string | null;
  date: string | null;
  referenceRange: { low?: number; high?: number; text?: string } | null;
  patientTarget: { low?: number; high?: number; text?: string; sourceReference?: string } | null;
  trend: PatientLabTrend;
  trendLabel: string;
  status: PatientLabStatus;
  statusLabel: string;
  reviewStatus: "new" | "awaiting-review" | "reviewed" | "discussed" | "follow-up-ordered";
  reviewStatusLabel: string;
  whatItChecks: string;
  whatItMayMean: string;
  nextStep: string;
  source: string;
  history: Array<{ id: string; value: number | string | null; unit: string | null; date: string | null }>;
  reviewedAt?: string;
  reviewedBy?: string;
  preliminary: boolean;
}

export interface LupusSystemOverview {
  id: string;
  title: string;
  status:
    | "being-monitored"
    | "active-issue"
    | "no-current-issue-documented"
    | "waiting-for-review"
    | "insufficient-information";
  statusLabel: string;
  summary: string;
  monitoredItems: string[];
  latestInformation: string[];
  nextStep: string;
  questions: string[];
}

export type NutritionGuidanceStatus =
  | "general-education"
  | "suggested-for-discussion"
  | "clinician-approved"
  | "dietitian-approved"
  | "waiting-for-review";

export interface NutritionGuidance {
  id: string;
  category: "sodium" | "protein" | "potassium" | "phosphorus" | "fluids" | "balanced-meals" | "food-safety" | "other";
  title: string;
  recommendation: string;
  whyItMayMatter: string;
  status: NutritionGuidanceStatus;
  statusLabel: string;
  supportingReferences: string[];
  reviewedBy?: string;
  reviewedAt?: string;
  safetyNote?: string;
}

export interface PatientCarePathway {
  id: string;
  title: string;
  purpose: string;
  status: string;
  statusLabel: string;
  nextStep: string;
  responsibleParty: string;
  patientAction?: string;
  dueDate?: string;
  appointment?: string;
  destination?: string;
  milestones: Array<{ label: string; completed: boolean }>;
  barriers: string[];
}

export interface PatientAppointment {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  start?: string;
  end?: string;
  provider: string;
  organization?: string;
  location?: string;
  telehealthUrl?: string;
  preparation: string[];
  pathway?: string;
  past: boolean;
}

export interface PatientMedication {
  id: string;
  name: string;
  status: string;
  dose?: string;
  route?: string;
  frequency?: string;
  reason?: string;
  prescriber?: string;
  startDate?: string;
  monitoring: Array<{ label: string; status: string; lastDate?: string }>;
  recentlyChanged: boolean;
  refillStatus?: string;
  genericName?: string;
  medicationClass?: string;
  therapyRole?: string;
  reconciliationStatus?: "reconciled" | "needs-review" | "not-reviewed";
  discrepancyType?: string;
}

export interface PatientCareTeamMember {
  id: string;
  name: string;
  role: string;
  organization?: string;
  howTheyHelp: string;
  currentInvolvement: string[];
  canMessage: boolean;
}

export interface PatientMessageSummary {
  id: string;
  subject: string;
  sender: string;
  sent?: string;
  direction: "inbox" | "sent";
  preview: string;
}

export interface PatientDocument {
  id: string;
  title: string;
  category: string;
  date?: string;
  source: string;
  description?: string;
  url?: string;
}

export interface PatientNextStep {
  id: string;
  title: string;
  whyItMatters: string;
  responsibleParty: string;
  dueDate?: string;
  patientAction?: string;
  status: string;
}

export interface PatientDashboardSummary {
  today: PatientNextStep[];
  copdStatus: {
    diagnosis: string;
    fev1Fvc?: string;
    fev1PercentPredicted?: string;
    airflowLimitation: string;
  };
  respiratoryStatus: {
    oxygenUse?: string;
    latestSpO2?: string;
    respiratoryRate?: string;
    dyspnea?: string;
    trend: string;
  };
  exacerbations: { summary: string; recentCount: number; hospitalizations: number };
  currentCare: { homeHealth: string; pulmonaryRehab: string; openTasks: number; nextAppointment?: PatientAppointment };
  nextAppointment?: PatientAppointment;
  carePlan: { activeSteps: number; nextAction: string; coordinator: string };
  medications: { activeCount: number; monitoringItems: number };
  messages: { unreadCount: number; latestSubject?: string };
}

export interface PatientPortalModel {
  patient: PatientIdentity;
  dashboard: PatientDashboardSummary;
  labs: PatientFriendlyLabResult[];
  nutrition: NutritionGuidance[];
  mealIdeas: Array<{ id: string; title: string }>;
  carePlan: PatientCarePathway[];
  appointments: PatientAppointment[];
  medications: PatientMedication[];
  careTeam: PatientCareTeamMember[];
  messages: PatientMessageSummary[];
  documents: PatientDocument[];
  dataStatus: {
    lastUpdatedAt: string;
    incompleteSections: string[];
    failedSections: string[];
  };
}

export interface PatientPortalRawData {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  observations: fhir4.Observation[];
  diagnosticReports: fhir4.DiagnosticReport[];
  medicationState: import("../medication-types.js").MedicationPatientState;
  careCoordination: import("../care-coordination/types.js").CareCoordinationPlan;
  serviceRequests: fhir4.ServiceRequest[];
  tasks: fhir4.Task[];
  carePlans: fhir4.CarePlan[];
  goals: fhir4.Goal[];
  appointments: fhir4.Appointment[];
  encounters: fhir4.Encounter[];
  careTeams: fhir4.CareTeam[];
  communications: fhir4.Communication[];
  documentReferences: fhir4.DocumentReference[];
  nutritionOrders: fhir4.NutritionOrder[];
  failedSections: string[];
}
