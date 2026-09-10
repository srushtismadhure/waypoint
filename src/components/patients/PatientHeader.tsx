import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PatientFormDialog } from "@/components/patients/PatientFormDialog";
import { DeactivatePatientDialog } from "@/components/patients/DeactivatePatientDialog";
import { formatPatientAge, formatPatientName } from "@/lib/formatters";

interface PatientHeaderProps {
  patient: fhir4.Patient;
  conditions: fhir4.Condition[];
  onCreateTask: () => void;
  onAddClinicalNote?: () => void;
  onPatientUpdated: (patient: fhir4.Patient) => void;
}

export function PatientHeader({ patient, onCreateTask, onAddClinicalNote, onPatientUpdated }: PatientHeaderProps) {
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [smartMode, setSmartMode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/smart/session", { credentials: "include", cache: "no-store" })
      .then(response => (response.ok ? response.json() : null))
      .then(body => {
        if (!cancelled) setSmartMode(Boolean(body?.authenticated));
      })
      .catch(() => {
        if (!cancelled) setSmartMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="mb-6 flex-row flex-wrap items-start justify-between gap-4 p-5">
      <div>
        {!smartMode && (
          <Button variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground" onClick={() => navigate("/patients")}>
            <ArrowLeft className="size-4" />
            Back to patients
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-foreground">{formatPatientName(patient)}</h2>
          {patient.active === false ? <Badge variant="neutral">Inactive</Badge> : <Badge variant="success">Active</Badge>}
          {smartMode && <Badge variant="neutral">SMART patient</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {patient.gender ?? "Unknown gender"} · {formatPatientAge(patient) ? `${formatPatientAge(patient)} years` : "Unknown age"} ·{" "}
          {patient.birthDate ?? "Unknown birth date"}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {onAddClinicalNote && (
          <Button size="sm" variant="outline" onClick={onAddClinicalNote}>
            <FileText className="size-4" />
            Add clinical note
          </Button>
        )}
        <Button size="sm" onClick={onCreateTask}>
          <Plus className="size-4" />
          Create task
        </Button>
        {!smartMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setEditOpen(true)}>Edit patient</DropdownMenuItem>
              <DropdownMenuItem disabled={!patient.id} onClick={() => patient.id && navigate(`/patients/${patient.id}/fhir-evidence`)}>
                View FHIR Evidence
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => setDeactivateOpen(true)} disabled={patient.active === false}>
                Deactivate patient
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!smartMode && (
        <PatientFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          patient={patient}
          onSaved={onPatientUpdated}
        />
      )}

      {!smartMode && patient.id && (
        <DeactivatePatientDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          patientId={patient.id}
          onDeactivated={onPatientUpdated}
        />
      )}
    </Card>
  );
}
