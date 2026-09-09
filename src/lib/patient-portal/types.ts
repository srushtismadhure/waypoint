export interface PatientIdentity {
  firstName: string;
  displayName: string;
  pronouns?: string;
  synthetic: boolean;
}

export interface PatientRespiratoryMetric {
  label: string;
  value: string;
  date?: string;
  context?: string;
  source: string;
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

export interface PatientCopdOverview {
  diagnosis: { label: string; status: string; onset?: string };
  respiratory: {
    spo2?: PatientRespiratoryMetric;
    respiratoryRate?: PatientRespiratoryMetric;
    dyspnea?: PatientRespiratoryMetric;
    oxygen?: PatientRespiratoryMetric;
    breathingComparedWithBaseline?: PatientRespiratoryMetric;
  };
  lungFunction: {
    fev1Percent?: PatientRespiratoryMetric;
    fev1Fvc?: PatientRespiratoryMetric;
    airflowCategory?: string;
  };
  exacerbations: {
    supported: boolean;
    count: number;
    recent: Array<{ id: string; label: string; date?: string; setting: string }>;
  };
  homeHealth: { status: string; latestVisitDate?: string; summary: string[] };
  pulmonaryRehab: { status: string; detail: string };
  followUp: { status: string; detail: string; nextAppointment?: PatientAppointment };
  medicationCheck: { status: string; detail: string };
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
  copd: PatientCopdOverview;
  today: PatientNextStep[];
  breathing: { spo2?: string; dyspnea?: string; oxygen?: string; status: string };
  homeHealth: { status: string; latestVisitDate?: string };
  pulmonaryRehab: { status: string; detail: string };
  nextAppointment?: PatientAppointment;
  carePlan: { activeSteps: number; nextAction: string; coordinator: string };
  medications: { activeCount: number; attentionNote?: string };
  messages: { unreadCount: number; latestSubject?: string };
}

export interface PatientPortalModel {
  patient: PatientIdentity;
  dashboard: PatientDashboardSummary;
  copdOverview: PatientCopdOverview;
  carePlan: PatientCarePathway[];
  appointments: PatientAppointment[];
  medications: PatientMedication[];
  careTeam: PatientCareTeamMember[];
  messages: PatientMessageSummary[];
  documents: PatientDocument[];
  /** Temporary compatibility fields for legacy portal endpoints that are no longer routed by the COPD UI. */
  lupusOverview: unknown[];
  labs: Array<{ id: string }>;
  nutrition: unknown[];
  mealIdeas: unknown[];
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
  medicationRequests: fhir4.MedicationRequest[];
  medicationStatements: fhir4.MedicationStatement[];
  serviceRequests: fhir4.ServiceRequest[];
  carePlans: fhir4.CarePlan[];
  goals: fhir4.Goal[];
  appointments: fhir4.Appointment[];
  encounters: fhir4.Encounter[];
  careTeams: fhir4.CareTeam[];
  communications: fhir4.Communication[];
  documentReferences: fhir4.DocumentReference[];
  questionnaireResponses: fhir4.QuestionnaireResponse[];
  failedSections: string[];
}
