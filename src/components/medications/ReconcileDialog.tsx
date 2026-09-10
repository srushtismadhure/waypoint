import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createMedicationStatement } from "@/lib/medication-client";

interface ReconcileTarget {
  medicationRequestId?: string;
  medicationText: string;
}

interface ReconcileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  target: ReconcileTarget | null;
  onSaved: () => void;
}

export function ReconcileDialog({ open, onOpenChange, patientId, target, onSaved }: ReconcileDialogProps) {
  const [status, setStatus] = useState<fhir4.MedicationStatement["status"]>("active");
  const [doseText, setDoseText] = useState("");
  const [frequency, setFrequency] = useState("");
  const [lastTaken, setLastTaken] = useState("");
  const [source, setSource] = useState("Patient");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || submitting) return;
    setSubmitting(true);
    try {
      const result = await createMedicationStatement(patientId, {
        medicationRequestId: target.medicationRequestId,
        medicationText: target.medicationText,
        status: status === "unknown" ? "not-taken" : status === "stopped" || status === "on-hold" ? "active" : status,
        reportedUse: ({ active: "taking", "not-taken": "not-taking", stopped: "different", unknown: "unavailable", intended: "unsure", "on-hold": "caregiver" } as Record<string, string>)[status],
        doseText: doseText.trim() || undefined,
        note: [note.trim(), frequency.trim() && `Reported frequency: ${frequency.trim()}`, lastTaken.trim() && `Last taken: ${lastTaken.trim()}`, `Source: ${source}`].filter(Boolean).join(". ") || undefined,
      });
      toast.success("Medication reconciliation documented.");
      if (result.cdsWarning) toast.warning(result.cdsWarning);
      setDoseText("");
      setFrequency("");
      setLastTaken("");
      setSource("Patient");
      setNote("");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to save the reconciliation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reconcile medication</DialogTitle>
          <DialogDescription>{target?.medicationText} — document what the patient reports actually taking.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-status">Patient-reported status</Label>
            <Select value={status} onValueChange={value => setStatus(value as fhir4.MedicationStatement["status"])} disabled={submitting}>
              <SelectTrigger id="reconcile-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Taking as prescribed</SelectItem>
                <SelectItem value="not-taken">Not taking</SelectItem>
                <SelectItem value="stopped">Taking differently</SelectItem>
                <SelectItem value="unknown">Ran out / medication unavailable</SelectItem>
                <SelectItem value="intended">Unsure</SelectItem>
                <SelectItem value="on-hold">Caregiver administers medication</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-dose">Patient-reported dose/frequency</Label>
            <Input id="reconcile-dose" value={doseText} onChange={e => setDoseText(e.target.value)} placeholder="e.g. 20 mg daily" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-frequency">Reported frequency</Label>
            <Input id="reconcile-frequency" value={frequency} onChange={e => setFrequency(e.target.value)} placeholder="e.g. twice daily" disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-last-taken">Last taken</Label>
            <Input id="reconcile-last-taken" type="date" value={lastTaken} onChange={e => setLastTaken(e.target.value)} disabled={submitting} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-source">Report source</Label>
            <Select value={source} onValueChange={setSource} disabled={submitting}>
              <SelectTrigger id="reconcile-source" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="Patient">Patient</SelectItem><SelectItem value="Caregiver">Caregiver</SelectItem><SelectItem value="Medication bottle">Medication bottle</SelectItem><SelectItem value="Discharge list">Discharge list</SelectItem><SelectItem value="Other">Other</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reconcile-note">Reason or note</Label>
            <Textarea id="reconcile-note" value={note} onChange={e => setNote(e.target.value)} disabled={submitting} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save reconciliation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
