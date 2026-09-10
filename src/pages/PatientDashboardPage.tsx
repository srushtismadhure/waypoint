import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { CreateTaskDialog } from "@/components/clinical/CreateTaskDialog";
import {
  getPatient,
  getPatientConditions,
  getPatientDiagnosticReports,
  getPatientMedicationRequests,
  getPatientMedicationStatements,
  getPatientEncounters,
  getPatientDetectedIssues,
  getPatientDocumentReferences,
  getPatientServiceRequests,
  getPatientImmunizations,
  getPatientObservations,
  getPatientTasks,
} from "@/lib/fhir";
import { CopdOverview } from "@/components/patient-overview/CopdOverview";

interface SectionState<T> {
  data: T;
  failed: boolean;
}

interface DashboardData {
  patient: fhir4.Patient;
  conditions: SectionState<fhir4.Condition[]>;
  observations: SectionState<fhir4.Observation[]>;
  medicationRequests: SectionState<fhir4.MedicationRequest[]>;
  diagnosticReports: SectionState<fhir4.DiagnosticReport[]>;
  tasks: SectionState<fhir4.Task[]>;
  encounters: SectionState<fhir4.Encounter[]>;
  medicationStatements: SectionState<fhir4.MedicationStatement[]>;
  detectedIssues: SectionState<fhir4.DetectedIssue[]>;
  documentReferences: SectionState<fhir4.DocumentReference[]>;
  serviceRequests: SectionState<fhir4.ServiceRequest[]>;
  immunizations: SectionState<fhir4.Immunization[]>;
}

function fromSettled<T>(result: PromiseSettledResult<T[]>): SectionState<T[]> {
  return result.status === "fulfilled" ? { data: result.value, failed: false } : { data: [], failed: true };
}

function isCopdCondition(condition: fhir4.Condition): boolean {
  const codings = condition.code?.coding ?? [];
  return (
    codings.some(coding => {
      const code = coding.code?.toUpperCase() ?? "";
      return code === "J44.9" || code.startsWith("J44") || /chronic obstructive pulmonary disease|\bcopd\b/i.test(coding.display ?? "");
    }) || /chronic obstructive pulmonary disease|\bcopd\b/i.test(condition.code?.text ?? "")
  );
}

export function PatientDashboardPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);

    try {
      const patient = await getPatient(patientId);
      const [
        conditions,
        observations,
        medicationRequests,
        diagnosticReports,
        tasks,
        encounters,
        medicationStatements,
        detectedIssues,
        documentReferences,
        serviceRequests,
        immunizations,
      ] = await Promise.allSettled([
        getPatientConditions(patientId),
        getPatientObservations(patientId),
        getPatientMedicationRequests(patientId),
        getPatientDiagnosticReports(patientId),
        getPatientTasks(patientId),
        getPatientEncounters(patientId),
        getPatientMedicationStatements(patientId),
        getPatientDetectedIssues(patientId),
        getPatientDocumentReferences(patientId),
        getPatientServiceRequests(patientId),
        getPatientImmunizations(patientId),
      ]);

      setData({
        patient,
        conditions: fromSettled(conditions),
        observations: fromSettled(observations),
        medicationRequests: fromSettled(medicationRequests),
        diagnosticReports: fromSettled(diagnosticReports),
        tasks: fromSettled(tasks),
        encounters: fromSettled(encounters),
        medicationStatements: fromSettled(medicationStatements),
        detectedIssues: fromSettled(detectedIssues),
        documentReferences: fromSettled(documentReferences),
        serviceRequests: fromSettled(serviceRequests),
        immunizations: fromSettled(immunizations),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load patient");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (loading) {
    return (
      <AppShell title="Patient overview" subtitle="COPD clinical overview and post-acute care status">
        <p className="text-sm text-muted-foreground">Loading patient...</p>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell title="Patient overview" subtitle="COPD clinical overview and post-acute care status">
        <Alert variant="destructive">
          <AlertDescription>{error ?? "Unable to load patient."}</AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  const {
    patient,
    conditions,
    observations,
    medicationRequests,
    diagnosticReports,
    tasks,
    encounters,
    medicationStatements,
    detectedIssues,
    documentReferences,
    serviceRequests,
    immunizations,
  } = data;

  const partialData = [
    conditions,
    observations,
    medicationRequests,
    diagnosticReports,
    tasks,
    encounters,
    medicationStatements,
    detectedIssues,
    documentReferences,
    serviceRequests,
    immunizations,
  ].some(section => section.failed);

  const hasCopdDiagnosis = conditions.data.some(isCopdCondition);

  return (
    <AppShell title="Patient overview" subtitle="COPD clinical overview and post-acute care status">
      <PatientHeader
        patient={patient}
        conditions={conditions.data}
        onCreateTask={() => setCreateTaskOpen(true)}
        onAddClinicalNote={() => patient.id && navigate(`/patients/${patient.id}/notes-coding`)}
        onPatientUpdated={() => setReloadKey(key => key + 1)}
      />

      {patient.id && <PatientSubNav patientId={patient.id} />}

      {!hasCopdDiagnosis && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            No COPD diagnosis was found in the available FHIR data for this patient. Waypoint will show the COPD workflow with safe empty states and will not infer a diagnosis from missing data.
          </AlertDescription>
        </Alert>
      )}

      {partialData && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Some clinical data could not be loaded from the current FHIR source.</span>
            <Button size="sm" variant="outline" onClick={() => setReloadKey(key => key + 1)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <CopdOverview
        patientId={patient.id ?? ""}
        conditions={conditions.data}
        observations={observations.data}
        medicationRequests={medicationRequests.data}
        tasks={tasks.data}
        encounters={encounters.data}
        medicationStatements={medicationStatements.data}
        detectedIssues={detectedIssues.data}
        documentReferences={documentReferences.data}
        serviceRequests={serviceRequests.data}
        immunizations={immunizations.data}
        diagnosticReports={diagnosticReports.data}
      />

      {patient.id && (
        <CreateTaskDialog
          open={createTaskOpen}
          onOpenChange={setCreateTaskOpen}
          patientId={patient.id}
          onCreated={() => setReloadKey(key => key + 1)}
        />
      )}
    </AppShell>
  );
}
