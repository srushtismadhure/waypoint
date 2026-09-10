import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPatientDocumentReferences, getPatientEncounters, getPatientQuestionnaireResponses } from "@/lib/fhir";
import { getClinicianWorklist } from "@/lib/worklist-client";
import { buildHomeHealthSummary, type HomeHealthSummary } from "@/lib/home-health-summary";

interface WorklistRow {
  patientId: string;
  name: string;
  openTaskCount: number;
  summary: HomeHealthSummary;
}

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

/** Cross-patient review queue. Opens the clinician summary, never the nurse documentation workspace. */
export function HomeHealthWorklistPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<WorklistRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const worklist = await getClinicianWorklist();
      const patients = worklist.allPatients.filter(item => item.patient.id);
      const built = await Promise.all(
        patients.map(async item => {
          const patientId = item.patient.id!;
          const [encounters, responses, documents] = await Promise.all([
            settle(getPatientEncounters(patientId), []),
            settle(getPatientQuestionnaireResponses(patientId), []),
            settle(getPatientDocumentReferences(patientId), []),
          ]);
          return { patientId, name: item.name, openTaskCount: item.openTaskCount, summary: buildHomeHealthSummary({ patientId, encounters, questionnaireResponses: responses, documentReferences: documents }) };
        }),
      );
      setRows(built.filter(row => row.summary.visit));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the home-health worklist.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell title="Home Health" subtitle="Completed home-health visits awaiting clinician review.">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-[color:var(--muted-foreground)]">{rows ? `${rows.length} ${rows.length === 1 ? "patient" : "patients"} with a completed visit` : "Loading..."}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!error && (
        <Card className="shadow-none">
          <CardContent className="p-0">
            {rows === null ? (
              <p className="p-5 text-sm text-[color:var(--muted-foreground)]">Loading home-health worklist...</p>
            ) : rows.length === 0 ? (
              <p className="p-5 text-sm text-[color:var(--muted-foreground)]">No completed home-health visits are available.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[var(--border)] text-xs uppercase text-[color:var(--muted-foreground)]">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Patient</th>
                    <th className="px-5 py-3 font-semibold">Latest visit</th>
                    <th className="px-5 py-3 font-semibold">Assessments</th>
                    <th className="px-5 py-3 font-semibold">Findings</th>
                    <th className="px-5 py-3 font-semibold">Open tasks</th>
                    <th className="px-5 py-3 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const completed = row.summary.assessments.filter(item => item.state === "completed").length;
                    return (
                      <tr key={row.patientId} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-5 py-3 font-medium">{row.name}</td>
                        <td className="px-5 py-3">{row.summary.visit?.date}</td>
                        <td className="px-5 py-3 text-[color:var(--muted-foreground)]">
                          {completed} / {row.summary.assessments.length} complete
                        </td>
                        <td className="px-5 py-3">{row.summary.findings.length}</td>
                        <td className="px-5 py-3">
                          <Badge variant={row.openTaskCount > 0 ? "warning" : "success"}>{row.openTaskCount}</Badge>
                        </td>
                        <td className="px-5 py-3">
                          <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${encodeURIComponent(row.patientId)}/home-health`)}>
                            Review
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
