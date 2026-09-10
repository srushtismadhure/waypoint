import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function AddMedicationFoundDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; onSave: (medication: string, dose: string, note: string) => Promise<void> }) {
  const [medication, setMedication] = useState(""); const [dose, setDose] = useState(""); const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) { event.preventDefault(); if (!medication.trim() || saving) return; setSaving(true); try { await onSave(medication, dose, note); setMedication(""); setDose(""); setNote(""); } finally { setSaving(false); } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Add medication found at home</DialogTitle></DialogHeader><form onSubmit={save} className="space-y-4"><div><Label htmlFor="home-medication">Medication</Label><Input id="home-medication" value={medication} onChange={event => setMedication(event.target.value)} placeholder="e.g. Spiriva or tiotropium" /></div><div><Label htmlFor="home-dose">Dose and frequency</Label><Input id="home-dose" value={dose} onChange={event => setDose(event.target.value)} placeholder="e.g. once daily" /></div><div><Label htmlFor="home-note">Source or reason</Label><Textarea id="home-note" value={note} onChange={event => setNote(event.target.value)} placeholder="Patient, caregiver, medication bottle, or discharge list" /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={!medication.trim() || saving}>{saving ? "Saving..." : "Save & reconcile"}</Button></DialogFooter></form></DialogContent></Dialog>;
}
