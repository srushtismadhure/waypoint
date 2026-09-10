import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/AuthProvider";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { MedicationSafetySummary } from "@/components/medications/MedicationSafetySummary";
import { ActiveRegimenSection } from "@/components/medications/ActiveRegimenSection";
import { ReconciliationPanel } from "@/components/medications/ReconciliationPanel";
import { MedicationHistorySection } from "@/components/medications/MedicationHistorySection";
import { MonitoringMatrix } from "@/components/medications/MonitoringMatrix";
import { CdsConflictsSection } from "@/components/medications/CdsConflictsSection";
import { MedicationSafetyTimeline, type TimelineEvent } from "@/components/medications/MedicationSafetyTimeline";
import { MedicationFhirEvidencePanel } from "@/components/medications/MedicationFhirEvidencePanel";
import { AddMedicationDialog } from "@/components/medications/AddMedicationDialog";
import { MedicationReasonDialog } from "@/components/medications/MedicationReasonDialog";
import { ReplaceMedicationDialog } from "@/components/medications/ReplaceMedicationDialog";
import { ReconcileDialog } from "@/components/medications/ReconcileDialog";
import { SymptomAssessmentDialog } from "@/components/medications/SymptomAssessmentDialog";
import { getPatient, getPatientConditions, getPatientObservations, getPatientTasks } from "@/lib/fhir";
import { getPatientMedicationState, signMedicationRequest } from "@/lib/medication-client";
import type { MedicationPatientState, MedicationRegimenItem, ReconciliationIssueView } from "@/lib/medication-types";
import { toast } from "sonner";

interface PageData {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  observations: fhir4.Observation[];
  medicationState: MedicationPatientState;
  timelineEvents: TimelineEvent[];
}

export function MedicationManagementPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManageOrders = user?.role === "clinician";

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [addOpen, setAddOpen] = useState(false);
  const [holdTarget, setHoldTarget] = useState<MedicationRegimenItem | null>(null);
  const [stopTarget, setStopTarget] = useState<MedicationRegimenItem | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<MedicationRegimenItem | null>(null);
  const [reconcileTarget, setReconcileTarget] = useState<{ medicationRequestId?: string; medicationText: string } | null>(null);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const evidenceRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const [patient, conditions, observations, tasks, medicationState] = await Promise.all([
        getPatient(patientId),
        getPatientConditions(patientId),
        getPatientObservations(patientId),
        getPatientTasks(patientId),
        getPatientMedicationState(patientId),
      ]);

      const allRegimenItems = [...Object.values(medicationState.regimenByGroup).flat(), ...medicationState.inactiveOrders];
      const timelineEvents: TimelineEvent[] = [
        ...allRegimenItems
          .filter(item => item.startDate)
          .map(item => ({ date: item.startDate!, type: "medication-start" as const, label: item.medicationText, source: `MedicationRequest/${item.id}` })),
        ...tasks
          .filter(t => t.authoredOn)
          .map(t => ({ date: t.authoredOn!, type: "task" as const, label: t.description ?? "Task", source: `Task/${t.id}` })),
        ...medicationState.assessments
          .filter(a => a.authored)
          .map(a => ({ date: a.authored!, type: "assessment" as const, label: `Medication experience assessment (${a.reportedSymptomCount} reported)`, source: `QuestionnaireResponse/${a.id}` })),
        ...medicationState.medicationStatements
          .filter(s => s.dateAsserted)
          .map(s => ({ date: s.dateAsserted!, type: "reconciliation" as const, label: `${s.medicationText} — ${s.status}`, source: `MedicationStatement/${s.id}` })),
      ];

      setData({ patient, conditions, observations, medicationState, timelineEvents });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load medication data.");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  const refresh = () => setReloadKey(k => k + 1);

  async function handleSign(item: MedicationRegimenItem) {
    try {
      await signMedicationRequest(item.id);
      toast.success("Medication order signed.");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to sign the medication order.");
    }
  }

  function handleReconcileFromCard(item: MedicationRegimenItem) {
    setReconcileTarget({ medicationRequestId: item.id, medicationText: item.medicationText });
  }

  function handleReconcileFromIssue(issue: ReconciliationIssueView) {
    setReconcileTarget({ medicationRequestId: issue.medicationRequestId, medicationText: issue.medicationText });
  }

  if (loading) {
    return (
      <AppShell title="Medication Management">
        <p className="text-sm text-muted-foreground">Loading medication data...</p>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell title="Medication Management">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error ?? "Unable to load medication data."}</span>
            <Button size="sm" variant="outline" onClick={refresh}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  const { patient, conditions, medicationState, timelineEvents } = data;
  const allRegimenItems = [...Object.values(medicationState.regimenByGroup).flat(), ...medicationState.inactiveOrders];

  return (
    <AppShell title="Medication Management" subtitle="Review the treatment regimen, medication safety, adherence, and monitoring over time.">
      <PatientHeader
        patient={patient}
        conditions={conditions}
        onCreateTask={() => {}}
        onAddClinicalNote={() => patient.id && navigate(`/patients/${patient.id}/notes-coding`)}
        onPatientUpdated={refresh}
      />

      {patientId && <PatientSubNav patientId={patientId} />}

      {!medicationState.cohortMember && (
        <Alert variant="warning" className="mb-4">
          <AlertDescription>
            This patient does not have a documented COPD diagnosis in the current record. Medication data below is still scoped to this patient
            only.
          </AlertDescription>
        </Alert>
      )}

      <MedicationSafetySummary counts={medicationState.safetyCounts} />

      <div className="mb-6">
        <ActiveRegimenSection
          regimenByGroup={medicationState.regimenByGroup}
          canManageOrders={canManageOrders}
          onAddMedication={() => setAddOpen(true)}
          onHold={item => setHoldTarget(item)}
          onStop={item => setStopTarget(item)}
          onReplace={item => setReplaceTarget(item)}
          onSign={handleSign}
          onReconcile={handleReconcileFromCard}
          onViewEvidence={() => evidenceRef.current?.scrollIntoView({ behavior: "smooth" })}
        />
      </div>

      <div className="mb-6">
        <MedicationSafetyTimeline events={timelineEvents} />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-white p-4">
        <div>
          <p className="text-sm font-semibold text-[color:var(--foreground)]">Patient-reported symptoms and medication experience</p>
          <p className="text-xs text-[color:var(--muted-foreground)]">
            {medicationState.assessments.length === 0 ? "No repeated symptom assessments are available." : `${medicationState.assessments.length} assessment(s) recorded.`}
          </p>
        </div>
        <Button size="sm" onClick={() => setAssessmentOpen(true)}>
          Complete medication assessment
        </Button>
      </div>

      <div className="mb-6">
        <MonitoringMatrix regimenItems={allRegimenItems.filter(i => i.status === "active")} />
      </div>

      <div className="mb-6">
        <ReconciliationPanel issues={medicationState.reconciliationIssues} onReconcile={handleReconcileFromIssue} onContactPatient={() => toast.info("Use the patient's Care Tasks to document outreach.")} />
      </div>

      <div className="mb-6">
        <MedicationHistorySection
          inactiveOrders={medicationState.inactiveOrders}
          statements={medicationState.medicationStatements}
          administrations={medicationState.medicationAdministrations}
        />
      </div>

      <div className="mb-6">
        <CdsConflictsSection issues={medicationState.detectedIssues} canResolve={canManageOrders} onResolved={refresh} />
      </div>

      <div ref={evidenceRef}>
        <MedicationFhirEvidencePanel
          medicationRequests={allRegimenItems}
          medicationStatements={medicationState.medicationStatements}
          medicationAdministrations={medicationState.medicationAdministrations}
          allergies={medicationState.allergies}
          detectedIssues={medicationState.detectedIssues}
        />
      </div>

      {patientId && (
        <AddMedicationDialog open={addOpen} onOpenChange={setAddOpen} patientId={patientId} conditions={conditions} onSaved={refresh} />
      )}

      {holdTarget && (
        <MedicationReasonDialog
          open={!!holdTarget}
          onOpenChange={open => !open && setHoldTarget(null)}
          mode="hold"
          medicationRequestId={holdTarget.id}
          medicationText={holdTarget.medicationText}
          onSaved={refresh}
        />
      )}

      {stopTarget && (
        <MedicationReasonDialog
          open={!!stopTarget}
          onOpenChange={open => !open && setStopTarget(null)}
          mode="stop"
          medicationRequestId={stopTarget.id}
          medicationText={stopTarget.medicationText}
          onSaved={refresh}
        />
      )}

      <ReplaceMedicationDialog open={!!replaceTarget} onOpenChange={open => !open && setReplaceTarget(null)} item={replaceTarget} onSaved={refresh} />

      {patientId && (
        <ReconcileDialog
          open={!!reconcileTarget}
          onOpenChange={open => !open && setReconcileTarget(null)}
          patientId={patientId}
          target={reconcileTarget}
          onSaved={refresh}
        />
      )}

      {patientId && <SymptomAssessmentDialog open={assessmentOpen} onOpenChange={setAssessmentOpen} patientId={patientId} onSaved={refresh} />}
    </AppShell>
  );
}
