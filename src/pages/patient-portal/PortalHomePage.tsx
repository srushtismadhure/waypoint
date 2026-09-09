import { useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, House, MessageCircle, Pill, Wind, Activity } from "lucide-react";
import { PortalPageHeader } from "@/components/patient-portal/PortalPageHeader";
import { PortalEmptyState, PortalErrorState, PortalIncompleteData, PortalLoadingState, SourceAndDate } from "@/components/patient-portal/PortalStates";
import { PatientStatusBadge } from "@/components/patient-portal/PatientStatusBadge";
import { UrgentHelp } from "@/components/patient-portal/UrgentHelp";
import { getPortalSummary } from "@/lib/patient-portal/client";
import { usePortalData } from "@/lib/patient-portal/use-portal-data";

function SummaryCard({ title, icon: Icon, children, to, linkLabel }: { title: string; icon: typeof House; children: React.ReactNode; to: string; linkLabel: string }) {
  return <article className="flex min-h-[210px] flex-col rounded-lg border border-[var(--border)] bg-white p-5 shadow-[0_8px_22px_rgba(31,36,48,0.04)]"><h2 className="flex items-center gap-2 text-base font-semibold text-[color:var(--foreground)]"><Icon className="size-5 text-[color:var(--link)]" aria-hidden="true" />{title}</h2><div className="mt-4 flex-1 text-sm text-[color:var(--muted-foreground)]">{children}</div><Link to={to} className="mt-4 inline-flex min-h-11 items-center gap-2 border-t border-[var(--border)] pt-3 text-sm font-semibold text-[color:var(--brand)] underline-offset-4 hover:underline">{linkLabel}<ArrowRight className="size-4" aria-hidden="true" /></Link></article>;
}

function dateTime(value?: string): string {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PortalHomePage() {
  const loader = useCallback(() => getPortalSummary(), []);
  const { data, loading, error, retry } = usePortalData(loader);
  if (loading) return <PortalLoadingState />;
  if (error || !data) return <PortalErrorState message={error ?? undefined} onRetry={retry} />;
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const dashboard = data.dashboard;

  return <div>
    <PortalPageHeader title={`${greeting}, ${data.patient.firstName}`} subtitle="Here is what is happening with your COPD care, home-health follow-up, and recovery." icon={House} />
    {data.patient.synthetic && <p className="mb-5 rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-3 text-sm font-medium text-[color:var(--link)]">This portal contains synthetic demonstration data, not a real patient record.</p>}
    <PortalIncompleteData status={data.dataStatus} />

    <section aria-labelledby="today-heading" className="mb-7"><h2 id="today-heading" className="text-lg font-semibold text-[color:var(--foreground)]">What needs your attention</h2><div className="mt-3 grid gap-3 lg:grid-cols-3">{dashboard.today.length === 0 ? <div className="lg:col-span-3"><PortalEmptyState title="No action is currently listed for you." detail="You can still review your breathing information, appointments, medicines, and messages." /></div> : dashboard.today.slice(0, 3).map(step => <article key={step.id} className="rounded-lg border border-[var(--border)] bg-white p-4"><PatientStatusBadge label={step.status} /><h3 className="mt-3 font-semibold text-[color:var(--foreground)]">{step.title}</h3><p className="mt-1 text-sm leading-6 text-[color:var(--muted-foreground)]">{step.whyItMatters}</p>{step.patientAction && <p className="mt-3 text-sm"><strong>Your action:</strong> {step.patientAction}</p>}</article>)}</div></section>

    <section aria-labelledby="overview-heading"><h2 id="overview-heading" className="text-lg font-semibold text-[color:var(--foreground)]">Your care overview</h2><div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <SummaryCard title="Breathing" icon={Wind} to="/portal/copd" linkLabel="View breathing & COPD"><PatientStatusBadge label={dashboard.breathing.status} /><dl className="mt-4 grid grid-cols-2 gap-3"><div><dt className="text-xs font-semibold">SpO₂</dt><dd className="mt-1 font-semibold text-[color:var(--foreground)]">{dashboard.breathing.spo2 ?? "Not available"}</dd></div><div><dt className="text-xs font-semibold">Breathlessness</dt><dd className="mt-1 font-semibold text-[color:var(--foreground)]">{dashboard.breathing.dyspnea ?? "Not available"}</dd></div><div className="col-span-2"><dt className="text-xs font-semibold">Home oxygen</dt><dd className="mt-1 font-semibold text-[color:var(--foreground)]">{dashboard.breathing.oxygen ?? "Not available"}</dd></div></dl></SummaryCard>
      <SummaryCard title="Home health" icon={House} to="/portal/copd" linkLabel="View latest update"><PatientStatusBadge label={dashboard.homeHealth.status} /><p className="mt-4">Latest documented visit: <strong className="text-[color:var(--foreground)]">{dashboard.homeHealth.latestVisitDate ? dateTime(dashboard.homeHealth.latestVisitDate) : "Not available"}</strong></p></SummaryCard>
      <SummaryCard title="Pulmonary rehabilitation" icon={Activity} to="/portal/copd" linkLabel="View rehab status"><PatientStatusBadge label={dashboard.pulmonaryRehab.status} /><p className="mt-4 leading-6">{dashboard.pulmonaryRehab.detail}</p></SummaryCard>
      <SummaryCard title="Next appointment" icon={CalendarDays} to="/portal/appointments" linkLabel="View appointments">{dashboard.nextAppointment ? <><p className="font-semibold text-[color:var(--foreground)]">{dashboard.nextAppointment.title}</p><p className="mt-2">{dateTime(dashboard.nextAppointment.start)}</p><p className="mt-1">{dashboard.nextAppointment.provider}</p></> : <p>No upcoming appointment is available in your record.</p>}</SummaryCard>
      <SummaryCard title="Medications" icon={Pill} to="/portal/medications" linkLabel="View medications"><p className="text-3xl font-semibold text-[color:var(--foreground)]">{dashboard.medications.activeCount}</p><p className="mt-1">current medication{dashboard.medications.activeCount === 1 ? "" : "s"} listed</p>{dashboard.medications.attentionNote && <p className="mt-4 font-medium text-[color:var(--warning-text)]">{dashboard.medications.attentionNote}</p>}</SummaryCard>
      <SummaryCard title="Messages" icon={MessageCircle} to="/portal/messages" linkLabel="Open messages"><p className="text-3xl font-semibold text-[color:var(--foreground)]">{dashboard.messages.unreadCount}</p><p className="mt-1">unread message{dashboard.messages.unreadCount === 1 ? "" : "s"}</p>{dashboard.messages.latestSubject && <p className="mt-4 font-medium text-[color:var(--foreground)]">Latest: {dashboard.messages.latestSubject}</p>}</SummaryCard>
    </div></section>

    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_0.7fr]"><UrgentHelp /><div className="rounded-lg border border-[var(--border)] bg-white p-4"><h2 className="text-sm font-semibold">Record update</h2><SourceAndDate date={data.dataStatus.lastUpdatedAt} /><p className="mt-2 text-sm text-[color:var(--muted-foreground)]">Waypoint shows confirmed information currently available from your medical record. Missing information is shown as unavailable rather than treated as a care gap.</p></div></div>
  </div>;
}
