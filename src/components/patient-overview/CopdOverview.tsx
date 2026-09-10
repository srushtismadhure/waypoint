import { useNavigate } from "react-router-dom";
import { Activity, ArrowRight, CircleAlert, Pill, Wind } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConditionsCard } from "@/components/clinical/ConditionsCard";
import { MedicationsCard } from "@/components/clinical/MedicationsCard";
import { TasksCard } from "@/components/clinical/TasksCard";
import { MedicationManagementCard } from "@/components/medications/MedicationManagementCard";
import { FhirTransparencyPanel } from "@/components/clinical/FhirTransparencyPanel";
import { CopdNeedsAttention } from "@/components/clinical/CopdNeedsAttention";

interface CopdOverviewProps {
  patientId: string;
  conditions: fhir4.Condition[];
  observations: fhir4.Observation[];
  medicationRequests: fhir4.MedicationRequest[];
  tasks: fhir4.Task[];
  encounters: fhir4.Encounter[];
  medicationStatements: fhir4.MedicationStatement[];
  detectedIssues: fhir4.DetectedIssue[];
  documentReferences: fhir4.DocumentReference[];
  serviceRequests: fhir4.ServiceRequest[];
  immunizations: fhir4.Immunization[];
  diagnosticReports: fhir4.DiagnosticReport[];
}

function latestObservation(observations: fhir4.Observation[], system: string, code: string): string | undefined {
  const item = observations.filter(value => value.code?.coding?.some(coding => coding.system === system && coding.code === code)).sort((a, b) => (b.effectiveDateTime ?? "").localeCompare(a.effectiveDateTime ?? ""))[0];
  if (!item) return undefined;
  if (item.valueQuantity?.value !== undefined) return `${item.valueQuantity.value}${item.valueQuantity.unit ? ` ${item.valueQuantity.unit}` : ""}`;
  if (item.valueInteger !== undefined) return String(item.valueInteger);
  return item.valueString ?? item.valueCodeableConcept?.text;
}

export function CopdOverview({ patientId, conditions, observations, medicationRequests, tasks, encounters, medicationStatements, detectedIssues, serviceRequests, immunizations, diagnosticReports }: CopdOverviewProps) {
  const navigate = useNavigate();
  const visibleConditions = conditions.filter(condition => !/lupus|sle|nephritis|renal|kidney|upcr|uacr|egfr|creatinine|anti.?dsdna|c3|c4/i.test(`${condition.code?.text ?? ""} ${condition.code?.coding?.map(coding => `${coding.display ?? ""} ${coding.code ?? ""}`).join(" ") ?? ""}`));
  const hasCopdDiagnosis = conditions.some(condition => condition.code?.coding?.some(coding => coding.code === "J44.9" || /chronic obstructive pulmonary disease|copd/i.test(coding.display ?? "")) || /chronic obstructive pulmonary disease|copd/i.test(condition.code?.text ?? ""));
  const fev1Percent = latestObservation(observations, "http://loinc.org", "19868-9");
  const fev1 = latestObservation(observations, "http://loinc.org", "20150-9");
  const fev1Fvc = latestObservation(observations, "http://loinc.org", "19926-5");
  const spo2 = latestObservation(observations, "http://loinc.org", "59408-5");
  const dyspnea = latestObservation(observations, "https://waypoint.example/fhir/CodeSystem/copd-demo", "mmrc-dyspnea");
  const oxygen = latestObservation(observations, "https://waypoint.example/fhir/CodeSystem/copd-demo", "oxygen-use");
  const respiratoryRate = latestObservation(observations, "http://loinc.org", "9279-1");
  const gold = fev1Percent ? Number.parseFloat(fev1Percent) : undefined;
  const goldLabel = gold === undefined ? "Insufficient spirometry data" : gold >= 80 ? "GOLD 1 airflow limitation" : gold >= 50 ? "GOLD 2 airflow limitation" : gold >= 30 ? "GOLD 3 airflow limitation" : "GOLD 4 airflow limitation";
  const exacerbationCount = encounters.filter(encounter => /exacerbation|hypoxemia/i.test(`${encounter.reasonCode?.map(reason => reason.text).join(" ")} ${encounter.type?.map(type => type.text).join(" ")}`)).length;
  const openTasks = tasks.filter(task => !["completed", "cancelled"].includes(task.status));
  const homeHealth = encounters.some(encounter => encounter.class?.code === "HH");
  const latestHomeHealth = encounters.filter(encounter => encounter.class?.code === "HH" && encounter.status === "finished").sort((a, b) => (a.period?.end ?? "").localeCompare(b.period?.end ?? "")).pop();
  const rehab = serviceRequests.some(request => /pulmonary rehab/i.test(request.code?.text ?? ""));
  const medicationIssue = detectedIssues.length > 0 || medicationStatements.some(statement => statement.status === "not-taken");
  const relevantVaccination = immunizations.some(item => item.status === "completed");
  const lungScreening = diagnosticReports.some(report => /lung|chest ct|screening/i.test(report.code?.text ?? ""));
  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card className="gap-3 py-5 shadow-none"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 text-sm text-[color:var(--brand)]"><Wind className="size-4" />COPD status</CardTitle></CardHeader><CardContent className="space-y-2 px-5 text-sm"><p className="text-base font-semibold">{hasCopdDiagnosis ? goldLabel : "No COPD diagnosis found in available FHIR data."}</p><p>FEV1 % predicted: {fev1Percent ?? "Not available"}</p><p>FEV1/FVC: {fev1Fvc ?? "Not available"}</p><p>Airflow limitation: {hasCopdDiagnosis ? goldLabel : "Not available"}</p></CardContent></Card>
      <Card id="respiratory-trends" className="gap-3 py-5 shadow-none"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 text-sm text-[color:var(--brand)]"><Activity className="size-4" />Respiratory status</CardTitle></CardHeader><CardContent className="space-y-2 px-5 text-sm"><p>SpO2: {spo2 ?? "Not available"}</p><p>Dyspnea / mMRC: {dyspnea ?? "Not available"}</p><p>Oxygen use: {oxygen ?? "Not available"}</p><p>Respiratory rate: {respiratoryRate ?? "Not available"}</p></CardContent></Card>
      <Card className="gap-3 py-5 shadow-none"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 text-sm text-[color:var(--brand)]"><CircleAlert className="size-4" />Exacerbations</CardTitle></CardHeader><CardContent className="space-y-2 px-5 text-sm"><p className="text-base font-semibold">{exacerbationCount ? `${exacerbationCount} documented` : "Insufficient data"}</p><p>Hospitalizations: {encounters.filter(encounter => encounter.class?.code === "IMP").length || "Insufficient data"}</p></CardContent></Card>
      <Card className="gap-3 py-5 shadow-none"><CardHeader className="px-5"><CardTitle className="flex items-center gap-2 text-sm text-[color:var(--brand)]"><Pill className="size-4" />Current care</CardTitle></CardHeader><CardContent className="space-y-2 px-5 text-sm"><p>Home health: {latestHomeHealth?.period?.end ? `Completed visit · ${latestHomeHealth.period.end.slice(0, 10)}` : homeHealth ? "Active" : "Insufficient data"}</p><p>Pulmonary rehab: {rehab ? "Referred" : "Not referred"}</p><p>Open tasks: {openTasks.length}</p><Badge variant={openTasks.length || medicationIssue ? "warning" : "success"}>{openTasks.length || medicationIssue ? "Needs review" : "Current"}</Badge><div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/home-health`)}>Home health</Button><Button size="sm" variant="outline" onClick={() => navigate(`/patients/${patientId}/pulmonary-rehab`)}>Pulmonary rehab</Button></div></CardContent></Card>
    </div>
    <Card className="gap-3 py-5 shadow-none"><CardHeader className="px-5"><CardTitle className="text-base text-[color:var(--brand)]">Needs attention</CardTitle></CardHeader><CardContent className="space-y-2 px-5 text-sm"><CopdNeedsAttention patientId={patientId} /></CardContent></Card>
    <div className="grid gap-4 xl:grid-cols-2"><ConditionsCard conditions={visibleConditions} /><MedicationsCard medicationRequests={medicationRequests} /></div>
    <MedicationManagementCard patientId={patientId} />
    <TasksCard tasks={tasks} />
    <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => navigate(`/patients/${patientId}/notes-coding`)}>Open clinical notes<ArrowRight className="size-4" /></Button><Button variant="outline" onClick={() => navigate(`/patients/${patientId}/fhir-evidence`)}>View FHIR evidence<ArrowRight className="size-4" /></Button></div>
    <FhirTransparencyPanel patient={undefined} conditions={conditions} observations={observations} medicationRequests={medicationRequests} tasks={tasks} />
  </div>;
}
