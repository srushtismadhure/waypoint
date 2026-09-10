import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPatient, getPatientConditions, getPatientDocumentReferences, getPatientEncounters, getPatientObservations, getPatientQuestionnaireResponses, getPatientTasks } from "@/lib/fhir";
import { getPatientMedicationState } from "@/lib/medication-client";
import { buildHomeHealthSummary, type AssessmentState, type HomeHealthSummary } from "@/lib/home-health-summary";
import type { MedicationPatientState } from "@/lib/medication-types";
import type { CopdFinding } from "@/lib/copd-cds";

interface PageData {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  summary: HomeHealthSummary;
  tasks: fhir4.Task[];
  medicationState?: MedicationPatientState;
}

const STATE_VARIANT: Record<AssessmentState, "success" | "warning" | "neutral"> = { completed: "success", "in-progress": "warning", "not-started": "neutral" };
const STATE_LABEL: Record<AssessmentState, string> = { completed: "Completed", "in-progress": "In progress", "not-started": "Not started" };

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export function ClinicianHomeHealthPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PageData | null>(null);
  const [findings, setFindings] = useState<CopdFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setData(null);
    setError(null);
    try {
      const patient = await getPatient(patientId);
      const [conditions, encounters, responses, documents, observations, tasks, medicationState] = await Promise.all([
        settle(getPatientConditions(patientId), []),
        settle(getPatientEncounters(patientId), []),
        settle(getPatientQuestionnaireResponses(patientId), []),
        settle(getPatientDocumentReferences(patientId), []),
        settle(getPatientObservations(patientId), []),
        settle(getPatientTasks(patientId), []),
        settle(getPatientMedicationState(patientId).then(state => state as MedicationPatientState | undefined), undefined),
      ]);
      setData({ patient, conditions, tasks, medicationState, summary: buildHomeHealthSummary({ patientId, encounters, questionnaireResponses: responses, documentReferences: documents, observations }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load home-health summary.");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // GET only: reviewing a summary must not persist new DetectedIssues or Tasks.
  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    setFindings(null);
    fetch(`/api/patients/${encodeURIComponent(patientId)}/copd-decision-support`, { signal: controller.signal })
      .then(async response => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { patientId: string; findings: CopdFinding[] }) => {
        if (body.patientId === patientId) setFindings(body.findings ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [patientId]);

  const openTasks = useMemo(() => (data?.tasks ?? []).filter(task => !["completed", "cancelled", "entered-in-error", "failed"].includes(task.status)), [data]);
  const reconciliation = data?.medicationState?.reconciliationIssues ?? [];

  if (error) {
    return (
      <AppShell title="Home Health">
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell title="Home Health">
        <p className="text-sm text-[color:var(--muted-foreground)]">Loading home-health summary...</p>
      </AppShell>
    );
  }

  const { summary } = data;

  return (
    <AppShell title="Home Health" subtitle="Completed home-health findings and escalations for clinician review.">
      <PatientHeader patient={data.patient} conditions={data.conditions} onCreateTask={() => {}} onAddClinicalNote={() => patientId && navigate(`/patients/${patientId}/notes-coding`)} onPatientUpdated={() => void load()} />
      {patientId && <PatientSubNav patientId={patientId} />}

      {!summary.visit ? (
        <Alert>
          <AlertDescription>No completed home-health visits are available for this patient.</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm text-[color:var(--brand)]">Latest home-health visit</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 text-sm">
                <div>
                  <dt className="text-xs text-[color:var(--muted-foreground)]">Visit date</dt>
                  <dd className="font-semibold">{summary.visit.date}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[color:var(--muted-foreground)]">Clinician</dt>
                  <dd className="font-semibold">{summary.visit.clinician}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[color:var(--muted-foreground)]">Status</dt>
                  <dd className="font-semibold capitalize">{summary.visit.status}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[color:var(--muted-foreground)]">Post-discharge day</dt>
                  <dd className="font-semibold">{summary.visit.postDischargeDay ?? "Not available"}</dd>
                </div>
              </dl>
              {summary.visit.visitType && <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">{summary.visit.visitType}</p>}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm text-[color:var(--brand)]">Assessments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {summary.assessments.map(assessment => (
                  <div key={assessment.label} className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0">
                    <span>{assessment.label}</span>
                    <span className="flex items-center gap-2">
                      {assessment.detail && <span className="text-xs text-[color:var(--muted-foreground)]">{assessment.detail}</span>}
                      <Badge variant={STATE_VARIANT[assessment.state]}>{STATE_LABEL[assessment.state]}</Badge>
                    </span>
                  </div>
                ))}
                {summary.finalizedNote && (
                  <div className="pt-2">
                    <p className="text-xs text-[color:var(--muted-foreground)]">
                      {summary.finalizedNote.title}
                      {summary.finalizedNote.author ? ` · ${summary.finalizedNote.author}` : ""}
                    </p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => patientId && navigate(`/patients/${patientId}/notes-coding`)}>
                      View final note
                      <ArrowRight className="size-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-none">
              <CardHeader>
                <CardTitle className="text-sm text-[color:var(--brand)]">Key home-health findings</CardTitle>
              </CardHeader>
              <CardContent>
                {summary.findings.length === 0 ? (
                  <p className="text-sm text-[color:var(--muted-foreground)]">No confirmed structured findings were recorded for this visit.</p>
                ) : (
                  <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                    {summary.findings.map(finding => (
                      <div key={finding.label}>
                        <dt className="text-xs text-[color:var(--muted-foreground)]">{finding.label}</dt>
                        <dd className="font-semibold">{finding.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-none">
            <CardHeader>
              <CardTitle className="text-sm text-[color:var(--brand)]">Medication reconciliation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {reconciliation.length === 0 ? (
                <p className="text-[color:var(--muted-foreground)]">No medication discrepancies are currently documented for this patient.</p>
              ) : (
                reconciliation.map(issue => (
                  <div key={issue.medicationRequestId} className="rounded-md border border-[var(--border)] p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{issue.medicationText}</span>
                      <Badge variant="warning">Needs clinician review</Badge>
                    </div>
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <dt className="text-xs text-[color:var(--muted-foreground)]">Prescribed</dt>
                        <dd>{issue.orderedSummary}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[color:var(--muted-foreground)]">Home-health verified</dt>
                        <dd>{issue.reportedSummary}</dd>
                      </div>
                    </dl>
                  </div>
                ))
              )}
              {patientId && (
                <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/medications`)}>
                  Review medications
                  <ArrowRight className="size-4" />
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="mt-4 shadow-none">
        <CardHeader>
          <CardTitle className="text-sm text-[color:var(--brand)]">Needs clinician attention</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {findings === null ? (
            <p className="text-[color:var(--muted-foreground)]">Checking COPD decision support...</p>
          ) : findings.length === 0 ? (
            <p className="text-[color:var(--muted-foreground)]">No unresolved COPD findings require clinician action for this patient.</p>
          ) : (
            findings.map(finding => (
              <div key={finding.id} className="rounded-md border border-[var(--border)] p-3">
                <p className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="size-4 text-[color:var(--warning-text)]" />
                  {finding.title}
                </p>
                <p className="mt-1 text-[color:var(--muted-foreground)]">{finding.detail}</p>
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">Evidence: {finding.sourceResources.join(", ")}</p>
                <Button size="sm" variant="outline" className="mt-2" onClick={() => navigate(finding.recommendedWorkflow)}>
                  {finding.linkLabel}
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            ))
          )}
          <p className="text-xs text-[color:var(--muted-foreground)]">
            {openTasks.length} open {openTasks.length === 1 ? "task" : "tasks"} for this patient.
            {patientId && (
              <Button size="sm" variant="ghost" className="ml-2 h-auto p-0 text-xs underline" onClick={() => navigate(`/patients/${patientId}/tasks`)}>
                View tasks
              </Button>
            )}
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
