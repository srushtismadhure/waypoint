import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPatient, getPatientConditions, getPatientTasks } from "@/lib/fhir";
import { COPD_CDS_SYSTEM } from "@/lib/copd-cds";

interface TaskRow {
  id: string;
  description: string;
  source: string;
  owner: string;
  priority: string;
  due: string;
  status: string;
  open: boolean;
}

const OPEN_STATUSES = ["draft", "requested", "received", "accepted", "ready", "in-progress", "on-hold"];

function sourceOf(task: fhir4.Task): string {
  if (task.code?.coding?.some(coding => coding.system === COPD_CDS_SYSTEM)) return "COPD decision support";
  if (task.focus?.reference?.startsWith("DetectedIssue/")) return "Detected issue";
  if (task.encounter?.reference) return "Home-health visit";
  return task.requester?.display ?? "Clinical workflow";
}

function toRow(task: fhir4.Task): TaskRow {
  return {
    id: task.id!,
    description: task.description ?? task.code?.text ?? task.code?.coding?.[0]?.display ?? "Task",
    source: sourceOf(task),
    owner: task.owner?.display ?? "Unassigned",
    priority: task.priority ?? "routine",
    due: task.restriction?.period?.end?.slice(0, 10) ?? task.executionPeriod?.end?.slice(0, 10) ?? "Not set",
    status: task.status,
    open: OPEN_STATUSES.includes(task.status),
  };
}

export function PatientTasksPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const [patient, setPatient] = useState<fhir4.Patient | null>(null);
  const [conditions, setConditions] = useState<fhir4.Condition[]>([]);
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setError(null);
    try {
      const [next, nextConditions, tasks] = await Promise.all([getPatient(patientId), getPatientConditions(patientId).catch(() => []), getPatientTasks(patientId)]);
      setPatient(next);
      setConditions(nextConditions);
      setRows(tasks.filter(task => task.id).map(toRow));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load tasks.");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => Number(b.open) - Number(a.open) || a.due.localeCompare(b.due)), [rows]);

  if (error) {
    return (
      <AppShell title="Tasks">
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

  return (
    <AppShell title="Tasks" subtitle="Open actions for this patient.">
      {patient && <PatientHeader patient={patient} conditions={conditions} onCreateTask={() => {}} onAddClinicalNote={() => patientId && navigate(`/patients/${patientId}/notes-coding`)} onPatientUpdated={() => void load()} />}
      {patientId && <PatientSubNav patientId={patientId} />}

      <Card className="shadow-none">
        <CardContent className="p-0">
          {rows === null ? (
            <p className="p-5 text-sm text-[color:var(--muted-foreground)]">Loading tasks...</p>
          ) : sorted.length === 0 ? (
            <p className="p-5 text-sm text-[color:var(--muted-foreground)]">No tasks are recorded for this patient.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--border)] text-xs uppercase text-[color:var(--muted-foreground)]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Task</th>
                  <th className="px-5 py-3 font-semibold">Source</th>
                  <th className="px-5 py-3 font-semibold">Owner</th>
                  <th className="px-5 py-3 font-semibold">Priority</th>
                  <th className="px-5 py-3 font-semibold">Due</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(row => (
                  <tr key={row.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3">{row.description}</td>
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{row.source}</td>
                    <td className="px-5 py-3">{row.owner}</td>
                    <td className="px-5 py-3 capitalize">{row.priority}</td>
                    <td className="px-5 py-3">{row.due}</td>
                    <td className="px-5 py-3">
                      <Badge variant={row.open ? "warning" : "success"}>{row.open ? "Open" : row.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
