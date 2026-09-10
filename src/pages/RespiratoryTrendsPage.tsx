import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowRight, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { ClinicalEventTimeline } from "@/components/clinical/ClinicalEventTimeline";
import { RespiratoryTrendChart } from "@/components/clinical/RespiratoryTrendChart";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getPatient,
  getPatientConditions,
  getPatientDetectedIssues,
  getPatientEncounters,
  getPatientObservations,
  getPatientQuestionnaireResponses,
  getPatientServiceRequests,
  getPatientTasks,
} from "@/lib/fhir";
import { buildClinicalEvents, buildRespiratorySeries, computeTrajectory, latestObservationPoint, latestReadings, type ClinicalEvent, type MetricSeries, type Trajectory } from "@/lib/respiratory-trends";

interface CopdFindingSummary {
  id: string;
  title: string;
  detail: string;
  explanation: string;
}

interface TrendsData {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  series: MetricSeries[];
  events: ClinicalEvent[];
}

const TRAJECTORY_LABELS: Record<Trajectory, string> = {
  improving: "Improving",
  stable: "Stable",
  worsening: "Worsening",
  "insufficient-data": "Insufficient data",
};

const TRAJECTORY_VARIANTS: Record<Trajectory, "success" | "warning" | "neutral"> = {
  improving: "success",
  stable: "success",
  worsening: "warning",
  "insufficient-data": "neutral",
};

function settled<T>(result: PromiseSettledResult<T[]>): T[] {
  return result.status === "fulfilled" ? result.value : [];
}

export function RespiratoryTrendsPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<TrendsData | null>(null);
  const [findings, setFindings] = useState<CopdFindingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!patientId) return;
    setData(null);
    setError(null);
    try {
      const patient = await getPatient(patientId);
      const [observations, responses, encounters, conditions, detectedIssues, tasks, serviceRequests] = await Promise.all([
        Promise.allSettled([getPatientObservations(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientQuestionnaireResponses(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientEncounters(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientConditions(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientDetectedIssues(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientTasks(patientId)]).then(([r]) => settled(r)),
        Promise.allSettled([getPatientServiceRequests(patientId)]).then(([r]) => settled(r)),
      ]);
      setData({
        patient,
        conditions,
        series: buildRespiratorySeries(patientId, observations, responses, encounters),
        events: buildClinicalEvents({ patientId, encounters, conditions, detectedIssues, tasks, serviceRequests, questionnaireResponses: responses }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load respiratory trends.");
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // GET, never POST: opening a chart must not persist DetectedIssues or Tasks.
  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    setFindings(null);
    fetch(`/api/patients/${encodeURIComponent(patientId)}/copd-decision-support`, { signal: controller.signal })
      .then(async response => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { patientId: string; findings: CopdFindingSummary[] }) => {
        if (body.patientId === patientId) setFindings(body.findings ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [patientId]);

  const summary = useMemo(() => (data ? computeTrajectory(data.series) : null), [data]);
  const readings = useMemo(() => (data ? latestReadings(data.series) : []), [data]);
  const lastPoint = useMemo(() => (data ? latestObservationPoint(data.series) : undefined), [data]);
  const chartable = data?.series.some(item => item.points.length > 0) ?? false;

  if (error) {
    return (
      <AppShell title="Respiratory Trends">
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

  if (!data || !summary) {
    return (
      <AppShell title="Respiratory Trends">
        <p className="text-sm text-[color:var(--muted-foreground)]">Loading respiratory trends...</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Respiratory Trends" subtitle="Longitudinal respiratory status from clinical and home-health observations.">
      <PatientHeader patient={data.patient} conditions={data.conditions} onCreateTask={() => {}} onAddClinicalNote={() => patientId && navigate(`/patients/${patientId}/notes-coding`)} onPatientUpdated={() => void load()} />
      {patientId && <PatientSubNav patientId={patientId} />}

      <Card className="mb-4 shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--brand)]">
            <Activity className="size-4" />
            Current trajectory
            <Badge variant={TRAJECTORY_VARIANTS[summary.trajectory]}>{TRAJECTORY_LABELS[summary.trajectory]}</Badge>
            {lastPoint && (
              <span className="ml-auto text-xs font-normal text-[color:var(--muted-foreground)]">
                Last observation: {lastPoint.sourceLabel} · {lastPoint.date}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {readings.map(({ definition, point }) => (
              <div key={definition.key}>
                <dt className="text-xs text-[color:var(--muted-foreground)]">{definition.title}</dt>
                <dd className="text-lg font-semibold text-[color:var(--foreground)]">{point ? `${point.value} ${definition.unit}` : "Not available"}</dd>
                {point && <p className="text-xs text-[color:var(--muted-foreground)]">{point.sourceLabel} · {point.date}</p>}
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card className="mb-4 shadow-none">
        <CardHeader>
          <CardTitle className="text-sm text-[color:var(--brand)]">Clinical Deterioration Signals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {summary.trajectory === "insufficient-data" ? (
            <p className="text-[color:var(--muted-foreground)]">Insufficient data to determine trajectory.</p>
          ) : summary.signals.length === 0 ? (
            <p className="text-[color:var(--muted-foreground)]">
              No directional change beyond the configured thresholds across {summary.comparedMetrics} measured {summary.comparedMetrics === 1 ? "metric" : "metrics"}.
            </p>
          ) : (
            <ul className="space-y-1">
              {summary.signals.map(signal => (
                <li key={signal.metric} className="flex items-start gap-2">
                  <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${signal.direction === "worsening" ? "text-[color:var(--warning-text)]" : "text-[color:var(--success)]"}`} />
                  <span>{signal.description}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-[var(--border)] bg-[var(--background)] p-3">
            <p className="mb-1 font-medium text-[color:var(--foreground)]">Decision support</p>
            {findings === null ? (
              <p className="text-[color:var(--muted-foreground)]">Checking COPD decision support...</p>
            ) : findings.length === 0 ? (
              <p className="text-[color:var(--muted-foreground)]">No actionable COPD finding is currently open. These measurements are shown as evidence only.</p>
            ) : (
              <>
                <p className="mb-2 text-[color:var(--muted-foreground)]">
                  The deterministic COPD rule engine has {findings.length} open {findings.length === 1 ? "finding" : "findings"} for this patient.
                </p>
                <ul className="mb-2 list-disc space-y-1 pl-5">
                  {findings.map(finding => (
                    <li key={finding.id}>{finding.title}</li>
                  ))}
                </ul>
              </>
            )}
            {patientId && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}#copd-needs-attention`)}>
                Review COPD findings
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {chartable ? (
        <div className="mb-4 grid gap-4 xl:grid-cols-2">
          {data.series.map(series => (
            <RespiratoryTrendChart key={series.definition.key} series={series} variant={series.definition.key === "rescueUse" ? "bar" : "line"} />
          ))}
        </div>
      ) : (
        <Alert className="mb-4">
          <AlertDescription>No respiratory trend data are available for this patient.</AlertDescription>
        </Alert>
      )}

      <ClinicalEventTimeline events={data.events} />

      <p className="mt-4 text-xs text-[color:var(--muted-foreground)]">
        Trends currently include EHR and home-health observations. Remote-monitoring data can be incorporated when available.
      </p>
    </AppShell>
  );
}
