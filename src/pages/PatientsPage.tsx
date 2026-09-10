import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AllPatientsTable } from "@/components/dashboard/AllPatientsTable";
import { PatientFormDialog } from "@/components/patients/PatientFormDialog";
import { DeactivatePatientDialog } from "@/components/patients/DeactivatePatientDialog";
import { getClinicianWorklist } from "@/lib/worklist-client";
import { useAuth } from "@/components/auth/AuthProvider";
import type { ClinicianWorklistResponse } from "@/lib/worklist-types";

type PatientFilter = "all" | "needs-review" | "open-tasks" | "insufficient-data";
type SortOption = "last-updated" | "name" | "age" | "most-tasks";

const FILTERS: { value: PatientFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs-review", label: "Needs review" },
  { value: "open-tasks", label: "Open tasks" },
  { value: "insufficient-data", label: "Insufficient data" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "last-updated", label: "Last updated" },
  { value: "name", label: "Name" },
  { value: "age", label: "Age" },
  { value: "most-tasks", label: "Most open tasks" },
];

export function PatientsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<ClinicianWorklistResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PatientFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("last-updated");
  const [includeInactive, setIncludeInactive] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editPatient, setEditPatient] = useState<fhir4.Patient | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<fhir4.Patient | null>(null);

  const load = useCallback(async () => {
    if (user?.mode === "ehr") return;
    setLoading(true);
    setError(null);
    try {
      const worklist = await getClinicianWorklist();
      setData(worklist);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load patients.");
    } finally {
      setLoading(false);
    }
  }, [user?.mode]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (user?.mode === "ehr" && user.patientId) {
    return <AppShell title="Current EHR Patient" subtitle="This patient was selected by the Medblocks clinician workflow."><Card><CardContent className="space-y-3 p-6"><p className="text-lg font-semibold">Patient/{user.patientId}</p><p className="text-sm text-[color:var(--muted-foreground)]">The Oracle patient context is preserved in the secure Waypoint session. Population search and the demo patient list are unavailable in this EHR session.</p><Button variant="outline" onClick={() => navigate(`/patients/${user.patientId}`)}>Open current patient</Button></CardContent></Card></AppShell>;
  }

  const filteredAllPatients = useMemo(() => {
    if (!data) return [];
    const trimmedQuery = query.trim().toLowerCase();

    const filtered = data.allPatients.filter(view => {
      if (!view.hasCopd) return false;
      if (!includeInactive && !view.active) return false;
      const identifiers = view.patient.identifier?.map(identifier => identifier.value ?? "").join(" ").toLowerCase() ?? "";
      if (trimmedQuery && !view.name.toLowerCase().includes(trimmedQuery) && !identifiers.includes(trimmedQuery)) return false;

      switch (filter) {
        case "needs-review":
          return (
            view.primaryAttentionReason === "possible-worsening-renal-pattern" ||
            view.primaryAttentionReason === "requires-review" ||
            view.primaryAttentionReason === "serology-change"
          );
        case "open-tasks":
          return view.openTaskCount > 0;
        case "insufficient-data":
          return view.monitoringStatus === "insufficient-data";
        default:
          return true;
      }
    });

    return filtered.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "age") return (b.age ?? -1) - (a.age ?? -1);
      if (sortBy === "most-tasks") return b.openTaskCount - a.openTaskCount || a.name.localeCompare(b.name);
      return (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? "") || a.name.localeCompare(b.name);
    });
  }, [data, query, filter, sortBy, includeInactive]);

  return (
    <AppShell title="Patients" subtitle="FHIR-connected COPD patient worklist">
      {loading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-[var(--info-bg)]" />
          ))}
        </div>
      )}

      {!loading && error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button size="sm" variant="outline" onClick={() => setRefreshKey(k => k + 1)}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!loading && !error && data && (
        <>
          <div className="mb-5 flex flex-col gap-3 border-b border-[var(--border)] pb-5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search patients by name or identifier..."
                className="h-10 w-full min-w-64 flex-1 max-w-md shadow-none"
              />
              <Select value={filter} onValueChange={value => setFilter(value as PatientFilter)}>
                <SelectTrigger size="sm" aria-label="Filter by status" className="min-w-36 shadow-none"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>{FILTERS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={value => setSortBy(value as SortOption)}>
                <SelectTrigger size="sm" aria-label="Sort patients" className="min-w-36 shadow-none"><SelectValue placeholder="Sort by" /></SelectTrigger>
                <SelectContent>{SORT_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
              <label className="flex min-h-9 cursor-pointer items-center gap-2 px-1 text-sm font-medium text-[color:var(--muted-foreground)]">
                <input
                  type="checkbox"
                  checked={includeInactive}
                  onChange={e => setIncludeInactive(e.target.checked)}
                  className="size-4 rounded border-[var(--info-border)] accent-[var(--primary)] outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--primary)]/35 focus-visible:ring-offset-2"
                />
                Include inactive
              </label>
              <Button type="button" variant="ghost" size="sm" className="text-[color:var(--muted-foreground)]" onClick={() => { setQuery(""); setFilter("all"); setSortBy("last-updated"); setIncludeInactive(false); }}>Clear filters</Button>
              <span className="text-sm font-medium text-[color:var(--muted-foreground)]">{filteredAllPatients.length} COPD patients</span>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)}>
                <RefreshCw className="size-4" />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                Create Patient
              </Button>
            </div>
          </div>

          {filteredAllPatients.length === 0 ? (
            <Card className="border-dashed bg-[var(--background)]">
              <CardContent className="text-center text-sm font-medium text-[color:var(--muted-foreground)]">No patients found.</CardContent>
            </Card>
          ) : (
            <AllPatientsTable patients={filteredAllPatients} quickLooks={{}} onEdit={setEditPatient} onDeactivate={setDeactivateTarget} />
          )}
        </>
      )}

      <PatientFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSaved={patient => {
          setRefreshKey(k => k + 1);
          if (patient.id) navigate(`/patients/${patient.id}`);
        }}
      />

      {editPatient && (
        <PatientFormDialog
          open={!!editPatient}
          onOpenChange={open => !open && setEditPatient(null)}
          mode="edit"
          patient={editPatient}
          onSaved={() => {
            setRefreshKey(k => k + 1);
            setEditPatient(null);
          }}
        />
      )}

      {deactivateTarget?.id && (
        <DeactivatePatientDialog
          open={!!deactivateTarget}
          onOpenChange={open => !open && setDeactivateTarget(null)}
          patientId={deactivateTarget.id}
          onDeactivated={() => {
            setRefreshKey(k => k + 1);
            setDeactivateTarget(null);
          }}
        />
      )}
    </AppShell>
  );
}
