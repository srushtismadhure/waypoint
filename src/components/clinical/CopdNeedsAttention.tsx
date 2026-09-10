import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import { resolveDetectedIssue } from "@/lib/medication-client";
import type { CopdFinding, CopdResult } from "@/lib/copd-cds";

export function CopdNeedsAttention({ patientId }: { patientId: string }) {
  const { user } = useAuth();
  const [result, setResult] = useState<CopdResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [review, setReview] = useState<CopdFinding | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError(null); setReview(null); setReason("");
    fetch(`/api/patients/${encodeURIComponent(patientId)}/copd-decision-support`, { method: "POST", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Unable to load decision support."); return body as CopdResult; })
      .then(body => { if (body.patientId !== patientId) throw new Error("Decision support patient mismatch."); setResult(body); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Decision support unavailable."); });
    return () => controller.abort();
  }, [patientId, revision]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("waypoint:medication-reconciled", refresh);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("waypoint:medication-reconciled", refresh); };
  }, []);
  async function resolve() {
    if (!review?.detectedIssueId || !reason.trim() || saving) return;
    setSaving(true);
    try { await resolveDetectedIssue(review.detectedIssueId, "continue", reason.trim()); setRevision(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to resolve finding."); }
    finally { setSaving(false); }
  }
  return <div id="copd-needs-attention" className="space-y-3">
    <div className="flex items-center justify-between gap-2"><span className="text-xs text-[color:var(--muted-foreground)]">{result ? `Rule version ${result.ruleVersion}` : "Loading confirmed findings..."}</span><Button size="icon" variant="ghost" title="Refresh decision support" aria-label="Refresh decision support" onClick={() => setRevision(value => value + 1)}><RefreshCw className="size-4" /></Button></div>
    {error && <p role="alert">{error}</p>}
    {result?.findings.length === 0 && <p>{result.insufficientData.length ? "No actionable finding established from the available data." : "No current actionable COPD findings."}</p>}
    {result?.findings.map(finding => <div key={finding.id} className="space-y-2 border-b border-[var(--border)] pb-3 last:border-0">
      <h3 className="font-semibold">{finding.title}</h3>
      <ul className="list-disc space-y-1 pl-4">{finding.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul>
      <p className="break-words text-xs text-[color:var(--muted-foreground)]">Evidence: {finding.sourceResources.join(", ")}</p>
      <div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to={`/patients/${encodeURIComponent(patientId)}/fhir-evidence`}>Review evidence</Link></Button><Button asChild size="sm" variant="outline"><Link to={`/patients/${encodeURIComponent(patientId)}/medications`}>Review medications</Link></Button>{user?.role === "clinician" && finding.detectedIssueId && <Button size="sm" onClick={() => { setReview(finding); setReason(""); }}>Resolve with reason</Button>}</div>
    </div>)}
    {review && <form className="space-y-2 border-t pt-3" onSubmit={event => { event.preventDefault(); void resolve(); }}><label className="block">Review reason<textarea required value={reason} disabled={saving} onChange={event => setReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-md border p-2" /></label><div className="flex gap-2"><Button type="submit" disabled={saving || !reason.trim()}>Confirm resolution</Button><Button variant="outline" type="button" disabled={saving} onClick={() => setReview(null)}>Cancel</Button></div></form>}
    {!!result?.insufficientData.length && <details><summary className="cursor-pointer text-xs">Data coverage</summary><ul className="mt-2 space-y-1 text-xs">{result.insufficientData.map(message => <li key={message}>{message}</li>)}</ul></details>}
  </div>;
}
