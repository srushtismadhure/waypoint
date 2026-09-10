import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PatientHeader } from "@/components/patients/PatientHeader";
import { PatientSubNav } from "@/components/patients/PatientSubNav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPatient, getPatientConditions, getPatientEncounters, getPatientObservations, getPatientQuestionnaireResponses, getPatientServiceRequests } from "@/lib/fhir";
import { buildRehabSummary, REHAB_STATUS_LABELS, type RehabStatus, type RehabSummary } from "@/lib/home-health-summary";
import { COPD_DEMO_SYSTEM, COPD_HOME_HEALTH_QUESTIONNAIRE, type CopdFinding } from "@/lib/copd-cds";

interface PageData {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  rehab: RehabSummary;
  context: { label: string; value: string }[];
}

const STATUS_VARIANT: Record<RehabStatus, "success" | "warning" | "neutral"> = {
  "not-referred": "neutral",
  "referral-recommended": "warning",
  "referral-placed": "success",
  "intake-scheduled": "success",
  enrolled: "success",
  completed: "success",
};

async function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

function latestQuantity(observations: fhir4.Observation[], code: string, system: string): string | undefined {
  const match = observations
    .filter(item => item.code?.coding?.some(coding => coding.system === system && coding.code === code))
    .sort((a, b) => (a.effectiveDateTime ?? "").localeCompare(b.effectiveDateTime ?? ""))
    .pop();
  if (!match) return undefined;
  if (match.valueQuantity?.value !== undefined) return `${match.valueQuantity.value}${match.valueQuantity.unit ? ` ${match.valueQuantity.unit}` : ""}`;
  return match.valueString ?? (match.valueInteger !== undefined ? String(match.valueInteger) : undefined);
}

function answer(responses: fhir4.QuestionnaireResponse[], linkId: string): string | undefined {
  return responses
    .filter(item => item.questionnaire === COPD_HOME_HEALTH_QUESTIONNAIRE)
    .sort((a, b) => (a.authored ?? "").localeCompare(b.authored ?? ""))
    .pop()
    ?.item?.find(item => item.linkId === linkId)?.answer?.[0]?.valueString;
}

export function PulmonaryRehabPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ruleIds, setRuleIds] = useState<string[]>([]);

  useEffect(() => {
    if (!patientId) return;
    const controller = new AbortController();
    fetch(`/api/patients/${encodeURIComponent(patientId)}/copd-decision-support`, { signal: controller.signal })
      .then(async response => (response.ok ? response.json() : Promise.reject(new Error("unavailable"))))
      .then((body: { patientId: string; findings: CopdFinding[] }) => {
        if (body.patientId === patientId) setRuleIds((body.findings ?? []).map(finding => finding.ruleId));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [patientId]);

  const load = useCallback(async () => {
    if (!patientId) return;
    setError(null);
    try {
      const patient = await getPatient(patientId);
      const [conditions, serviceRequests, encounters, observations, responses] = await Promise.all([
        settle(getPatientConditions(patientId), []),
        settle(getPatientServiceRequests(patientId), []),
        settle(getPatientEncounters(patientId), []),
        settle(getPatientObservations(patientId), []),
        settle(getPatientQuestionnaireResponses(patientId), []),
      ]);
      setData({
        patient,
        conditions,
        rehab: buildRehabSummary({ patientId, serviceRequests, encounters, copdFindingRuleIds: ruleIds }),
        context: [
          { label: "6-minute walk distance", value: latestQuantity(observations, "6-minute-walk-distance", COPD_DEMO_SYSTEM) ?? "Not available" },
          { label: "Dyspnea (mMRC)", value: latestQuantity(observations, "mmrc-dyspnea", COPD_DEMO_SYSTEM) ?? answer(responses, "mmrc") ?? "Not available" },
          { label: "Functional status", value: answer(responses, "functional") ?? "Not available" },
          { label: "Smoking status", value: answer(responses, "smoking-status") ?? "Not available" },
          {
            label: "Recent COPD hospitalization",
            value: encounters.some(item => item.class?.code === "IMP" && item.status === "finished") ? "Documented" : "Not documented",
          },
        ],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load pulmonary rehabilitation status.");
    }
  }, [patientId, ruleIds]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <AppShell title="Pulmonary Rehabilitation">
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
      <AppShell title="Pulmonary Rehabilitation">
        <p className="text-sm text-[color:var(--muted-foreground)]">Loading pulmonary rehabilitation status...</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Pulmonary Rehabilitation" subtitle="Referral status and recovery context for this patient.">
      <PatientHeader patient={data.patient} conditions={data.conditions} onCreateTask={() => {}} onAddClinicalNote={() => patientId && navigate(`/patients/${patientId}/notes-coding`)} onPatientUpdated={() => void load()} />
      {patientId && <PatientSubNav patientId={patientId} />}

      <Card className="mb-4 shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-3 text-sm text-[color:var(--brand)]">
            Referral status
            <Badge variant={STATUS_VARIANT[data.rehab.status]}>{REHAB_STATUS_LABELS[data.rehab.status]}</Badge>
            {data.rehab.nextAppointment && <span className="ml-auto text-xs font-normal text-[color:var(--muted-foreground)]">Next appointment: {data.rehab.nextAppointment}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {data.rehab.rationale.length === 0 ? (
            <p className="text-[color:var(--muted-foreground)]">No documented indication for pulmonary rehabilitation is currently recorded.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {data.rehab.rationale.map(reason => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
          {data.rehab.referenceResources.length > 0 && <p className="text-xs text-[color:var(--muted-foreground)]">Evidence: {data.rehab.referenceResources.join(", ")}</p>}
          {patientId && (
            <Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/care-coordination`)}>
              Review referral
              <ArrowRight className="size-4" />
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm text-[color:var(--brand)]">Clinical context</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 text-sm">
            {data.context.map(item => (
              <div key={item.label}>
                <dt className="text-xs text-[color:var(--muted-foreground)]">{item.label}</dt>
                <dd className="font-semibold">{item.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </AppShell>
  );
}
