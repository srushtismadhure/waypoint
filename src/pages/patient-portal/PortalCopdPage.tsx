import { useCallback } from "react";
import { Activity, CalendarDays, HeartPulse, House, Pill, Stethoscope, Wind } from "lucide-react";
import { PortalPageHeader } from "@/components/patient-portal/PortalPageHeader";
import { PatientStatusBadge } from "@/components/patient-portal/PatientStatusBadge";
import { PortalErrorState, PortalIncompleteData, PortalLoadingState, SourceAndDate } from "@/components/patient-portal/PortalStates";
import { UrgentHelp } from "@/components/patient-portal/UrgentHelp";
import { getPortalCopd } from "@/lib/patient-portal/client";
import { usePortalData } from "@/lib/patient-portal/use-portal-data";

function dateOnly(value?: string): string {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}

function Metric({ label, value, date }: { label: string; value?: string; date?: string }) {
  return <div className="rounded-lg border border-[var(--border)] bg-white p-4"><dt className="text-xs font-semibold text-[color:var(--muted-foreground)]">{label}</dt><dd className="mt-1 text-lg font-semibold text-[color:var(--foreground)]">{value ?? "Not available"}</dd>{date && <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">Recorded {dateOnly(date)}</p>}</div>;
}

export function PortalCopdPage() {
  const loader = useCallback(() => getPortalCopd(), []);
  const { data, loading, error, retry } = usePortalData(loader);
  if (loading) return <PortalLoadingState />;
  if (error || !data) return <PortalErrorState message={error ?? undefined} onRetry={retry} />;
  const copd = data.copd;

  return <div>
    <PortalPageHeader title="Breathing & COPD" subtitle="See the COPD information your care team has documented, including breathing checks, home-health follow-up, and care transitions." icon={Wind} />
    <PortalIncompleteData status={data.dataStatus} />

    <section className="mb-6 rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="diagnosis-heading">
      <h2 id="diagnosis-heading" className="flex items-center gap-2 text-lg font-semibold"><Stethoscope className="size-5 text-[color:var(--link)]" aria-hidden="true" />Your COPD record</h2>
      <p className="mt-2 font-medium">{copd.diagnosis.label}</p>
      <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">Status: {copd.diagnosis.status}{copd.diagnosis.onset ? ` · documented since ${dateOnly(copd.diagnosis.onset)}` : ""}</p>
    </section>

    <section className="mb-7" aria-labelledby="breathing-heading">
      <h2 id="breathing-heading" className="flex items-center gap-2 text-lg font-semibold"><Activity className="size-5 text-[color:var(--link)]" aria-hidden="true" />Latest breathing information</h2>
      <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">These values are shown as documented. A single number does not describe your overall COPD status by itself.</p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Oxygen saturation (SpO₂)" value={copd.respiratory.spo2?.value} date={copd.respiratory.spo2?.date} />
        <Metric label="Breathlessness (mMRC)" value={copd.respiratory.dyspnea?.value} date={copd.respiratory.dyspnea?.date} />
        <Metric label="Home oxygen" value={copd.respiratory.oxygen?.value} date={copd.respiratory.oxygen?.date} />
        <Metric label="Respiratory rate" value={copd.respiratory.respiratoryRate?.value} date={copd.respiratory.respiratoryRate?.date} />
      </dl>
      {copd.respiratory.breathingComparedWithBaseline && <p className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--info-bg)] p-3 text-sm text-[color:var(--link)]"><strong>Compared with your usual breathing:</strong> {copd.respiratory.breathingComparedWithBaseline.value}</p>}
    </section>

    <section className="mb-7 rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="lung-function-heading">
      <h2 id="lung-function-heading" className="flex items-center gap-2 text-lg font-semibold"><HeartPulse className="size-5 text-[color:var(--link)]" aria-hidden="true" />Lung function</h2>
      <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">Spirometry measures airflow. The airflow category below does not, by itself, describe your total symptoms, risk, or treatment needs.</p>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label="FEV₁ % predicted" value={copd.lungFunction.fev1Percent?.value} date={copd.lungFunction.fev1Percent?.date} /><Metric label="FEV₁/FVC" value={copd.lungFunction.fev1Fvc?.value} date={copd.lungFunction.fev1Fvc?.date} /><Metric label="Airflow limitation" value={copd.lungFunction.airflowCategory} /></dl>
    </section>

    <div className="mb-7 grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="home-health-heading"><h2 id="home-health-heading" className="flex items-center gap-2 text-lg font-semibold"><House className="size-5 text-[color:var(--link)]" aria-hidden="true" />Home-health update</h2><div className="mt-3"><PatientStatusBadge label={copd.homeHealth.status} /></div><p className="mt-3 text-sm text-[color:var(--muted-foreground)]">Latest visit: {dateOnly(copd.homeHealth.latestVisitDate)}</p>{copd.homeHealth.summary.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[color:var(--muted-foreground)]">{copd.homeHealth.summary.map(item => <li key={item}>{item}</li>)}</ul>}</section>
      <section className="rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="rehab-heading"><h2 id="rehab-heading" className="flex items-center gap-2 text-lg font-semibold"><Activity className="size-5 text-[color:var(--link)]" aria-hidden="true" />Pulmonary rehabilitation</h2><div className="mt-3"><PatientStatusBadge label={copd.pulmonaryRehab.status} /></div><p className="mt-3 text-sm leading-6 text-[color:var(--muted-foreground)]">{copd.pulmonaryRehab.detail}</p></section>
      <section className="rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="followup-heading"><h2 id="followup-heading" className="flex items-center gap-2 text-lg font-semibold"><CalendarDays className="size-5 text-[color:var(--link)]" aria-hidden="true" />Follow-up</h2><div className="mt-3"><PatientStatusBadge label={copd.followUp.status} /></div><p className="mt-3 text-sm leading-6 text-[color:var(--muted-foreground)]">{copd.followUp.detail}</p></section>
      <section className="rounded-lg border border-[var(--border)] bg-white p-5" aria-labelledby="med-check-heading"><h2 id="med-check-heading" className="flex items-center gap-2 text-lg font-semibold"><Pill className="size-5 text-[color:var(--link)]" aria-hidden="true" />Medication check</h2><div className="mt-3"><PatientStatusBadge label={copd.medicationCheck.status} /></div><p className="mt-3 text-sm leading-6 text-[color:var(--muted-foreground)]">{copd.medicationCheck.detail}</p></section>
    </div>

    <section className="mb-7" aria-labelledby="exacerbations-heading"><h2 id="exacerbations-heading" className="text-lg font-semibold">Recent flare-ups and acute-care visits</h2>{!copd.exacerbations.supported ? <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">Encounter history is not available, so this section cannot be evaluated.</p> : copd.exacerbations.recent.length === 0 ? <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">No COPD flare-up encounter is documented in the available encounter history.</p> : <div className="mt-3 space-y-2">{copd.exacerbations.recent.map(item => <article key={item.id} className="rounded-lg border border-[var(--border)] bg-white p-4"><p className="font-semibold">{item.label}</p><p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{dateOnly(item.date)} · {item.setting}</p></article>)}</div>}</section>

    <UrgentHelp />
    <div className="mt-5"><SourceAndDate date={data.dataStatus.lastUpdatedAt} /></div>
  </div>;
}
