/**
 * All request handlers, shared between the two deployment targets:
 *  - src/index.ts: a persistent Bun.serve() process (local dev, Docker/Railway/Render/Fly)
 *  - api/*.ts: individual Vercel serverless functions (see api/_lib/adapter.ts)
 *
 * Every handler here is a plain (req: Request) => Promise<Response> function —
 * no framework-specific request/response types — so both entry points can
 * call the exact same code with zero duplication.
 */
import { getFhirConfig } from "../lib/fhir-config.js";
import OpenAI from "openai";
import { extractOasisCandidates } from "../lib/oasis/extract.server";
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createDemoSessionToken,
  createEhrSessionToken,
  DEMO_USERS,
  forbiddenResponse,
  getSessionFromRequest,
  isDemoRole,
  requirePatient,
  requireRole,
  requireStaff,
  unauthorizedResponse,
  verifySessionToken,
} from "../lib/auth.js";
import { resolveMedblocksLaunchContext, resourceId } from "../lib/medblocks-launch-context.js";
import { buildPatientResource, mergePatientResource, validatePatientInput, type PatientFormInput } from "../lib/patient-input.js";
import {
  createFhirResource,
  extractIdFromLocation,
  readFhirResource,
  searchFhirResource,
  updateFhirResource,
} from "../lib/fhir-server-client.js";
import { buildClinicianWorklist } from "../lib/worklist.js";
import { referencesPatient } from "../lib/formatters.js";
import {
  buildNurseMntWorklist,
  contactPatient,
  coordinateScheduling,
  createDraftReferral,
  declineReferral,
  documentBarrier,
  getPatientMntState,
  modifyReferral,
  sendForSignature,
  signReferral,
  type MntActionResult,
} from "../lib/mnt.js";
import type { PatientWillingness } from "../lib/mnt-types.js";
import {
  evaluateMedicationSafety,
  cdsHooksResponse,
  persistDetectedIssuesFromEvaluation,
  CDS_SERVICES_DISCOVERY,
  type CdsHooksRequestBody,
} from "../lib/cds-hooks.js";
import {
  createDraftMedicationRequest,
  createMedicationAssessment,
  createMedicationStatement,
  getPatientMedicationState,
  holdMedicationRequest,
  replaceMedicationRequest,
  resolveDetectedIssue,
  signMedicationRequest,
  stopMedicationRequest,
  type CreateDraftMedicationInput,
  type MedicationActionResult,
  type SymptomAnswerInput,
} from "../lib/medications.js";
import {
  analyzeClinicalNote,
  approveClinicalConcept,
  approveSdohReferralDraft,
  buildPriorAuthReadiness,
  cancelSdohReferralDraft,
  createClinicalNoteDraft,
  createPatientTask,
  createSdohReferralDraft,
  finalizeClinicalNoteDraft,
  loadClinicalNoteDraft,
  rejectClinicalConcept,
  saveClinicalNoteDraft,
} from "../lib/notes-coding.js";
import type {
  AnalyzeClinicalNoteInput,
  ApproveConceptInput,
  CreatePriorAuthTaskInput,
  RejectConceptInput,
  SaveClinicalNoteInput,
  SdohReferralDraftInput,
} from "../lib/notes-coding-types.js";
import {
  getDialysisFacilities,
  getDialysisFacility,
  getKidneyTransplantProgram,
  getKidneyTransplantPrograms,
} from "../lib/kidney-services/repository.js";
import {
  parseDialysisSearchParams,
  parseKidneyServiceSearchParams,
  searchDialysisFacilities,
  searchTransplantPrograms,
} from "../lib/kidney-services/search.js";
import { createFhirDirectoryBundle } from "../lib/kidney-services/to-fhir-directory-bundle.js";
import { loadCareCoordinationData } from "../lib/care-coordination/load-care-coordination-data.js";
import { buildCareCoordinationPlan } from "../lib/care-coordination/normalize.js";
import {
  confirmCareCoordinationReferral,
  createCoordinationCommunication,
  previewCareCoordinationReferral,
  updateCoordinationTask,
  type ReferralActionBody,
  type TaskActionBody,
} from "../lib/care-coordination/service.js";
import { loadPatientPortalData } from "../lib/patient-portal/load-patient-portal-data.js";
import { buildPatientPortalModel } from "../lib/patient-portal/build-patient-portal-model.js";
import {
  createAppointmentChangeRequest,
  createNutritionSupportRequest,
  createPatientPortalMessage,
  createRefillRequest,
} from "../lib/patient-portal/service.js";
import { loadSleSystemsReviewData } from "../lib/sle-systems-review/load-sle-systems-review-data.js";
import { buildSleSystemsReviewModel } from "../lib/sle-systems-review/normalize.js";
import { createSleSystemReviewTask, submitSleSystemAssessment } from "../lib/sle-systems-review/service.js";
import type { SubmitSleAssessmentInput } from "../lib/sle-systems-review/types.js";

const HOP_BY_HOP_RESPONSE_HEADERS = new Set(["content-type", "location", "content-location", "etag", "last-modified"]);
const FORWARDED_REQUEST_HEADERS = ["if-match", "if-none-match", "if-modified-since", "prefer"];
const VERCEL_ROUTE_PARAM_KEYS = ["resource", "id", "patientId", "referralId", "action", "...path"];

export function networkErrorResponse() {
  return Response.json(
    {
      resourceType: "OperationOutcome",
      issue: [{ severity: "error", code: "exception", diagnostics: "The application could not reach the configured FHIR server." }],
    },
    { status: 502, headers: { "Content-Type": "application/fhir+json" } },
  );
}

/**
 * Proxies a request to Medblocks. `fhirSubPath` is the path *after* the public `/fhir` prefix
 * (e.g. `/Patient`), passed in explicitly so callers don't need to agree on a URL prefix.
 */
export async function proxyFhirRequest(req: Request, fhirSubPath: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  if (getSessionFromRequest(req)?.mode === "ehr") return Response.json({ error: "EHR FHIR reads require the Medblocks downstream record adapter; the demo FHIR source is not used for an EHR session." }, { status: 501 });

  const fhirConfig = getFhirConfig();
  const incomingUrl = new URL(req.url);
  const upstreamUrl = new URL(`${fhirConfig.baseUrl}${fhirSubPath || "/"}`);

  const upstreamSearchParams = new URLSearchParams(incomingUrl.search);
  for (const key of VERCEL_ROUTE_PARAM_KEYS) {
    upstreamSearchParams.delete(key);
  }
  upstreamUrl.search = upstreamSearchParams.toString();

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${fhirConfig.bearerToken}`);
  headers.set("Accept", "application/fhir+json");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  if (hasBody) {
    const incomingContentType = req.headers.get("content-type");
    headers.set("Content-Type", incomingContentType && incomingContentType.trim() ? incomingContentType : "application/fhir+json");
  }

  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(headerName);
    if (value) headers.set(headerName, value);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      // @ts-expect-error - required by undici/Bun when streaming a body
      duplex: hasBody ? "half" : undefined,
    });
  } catch (error) {
    console.error("FHIR upstream request failed:", error instanceof Error ? error.message : "unknown error");
    return networkErrorResponse();
  }

  const responseHeaders = new Headers();
  upstreamResponse.headers.forEach((value, key) => {
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
  });

  return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
}

function isOperationOutcome(value: unknown): value is fhir4.OperationOutcome {
  return typeof value === "object" && value !== null && (value as { resourceType?: string }).resourceType === "OperationOutcome";
}

function validationErrorOutcome(errors: { field: string; message: string }[]): fhir4.OperationOutcome {
  return {
    resourceType: "OperationOutcome",
    issue: errors.map(error => ({ severity: "error", code: "invalid", diagnostics: error.message, expression: [error.field] })),
  };
}

export async function handleDemoLogin(req: Request): Promise<Response> {
  let body: { role?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — validated below
  }

  const role = isDemoRole(body.role) ? body.role : null;
  if (!role) return Response.json({ error: "A valid demo role is required." }, { status: 400 });

  try {
    const token = createDemoSessionToken(role);
    const user = DEMO_USERS[role];
    const session = verifySessionToken(token);
    return Response.json(
      {
        authenticated: true,
        user: { email: user.email, displayName: user.displayName, role, patientId: user.patientId, mode: "demo" },
        expiresAt: session?.exp,
      },
      { status: 200, headers: { "Set-Cookie": buildSessionCookie(token), "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Demo login failed:", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Demo login is not configured correctly." }, { status: 500 });
  }
}

export async function handleLogout(): Promise<Response> {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        "Set-Cookie": buildClearedSessionCookie(),
        "Cache-Control": "no-store",
        "Clear-Site-Data": '"cache"',
      },
    },
  );
}

export async function handleSession(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return Response.json({ authenticated: false }, { status: 200, headers: { "Cache-Control": "no-store" } });
  return Response.json(
    {
      authenticated: true,
      user: {
        email: session.email,
        displayName: session.displayName,
        role: session.role,
        patientId: session.patientId,
        mode: session.mode,
        encounterId: session.encounterId,
        fhirUser: session.fhirUser,
        fhirSource: session.fhirSource,
        fhirBaseUrl: session.fhirBaseUrl,
      },
      expiresAt: session.exp,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function handleMedblocksLaunch(req: Request): Promise<Response> {
  const handle = new URL(req.url).searchParams.get("mb_launch");
  if (!handle || handle.length > 512) return Response.json({ error: "A valid mb_launch handle is required." }, { status: 400 });
  try {
    const context = await resolveMedblocksLaunchContext(handle);
    const token = createEhrSessionToken({ patientId: resourceId(context.patient, "Patient")!, encounterId: resourceId(context.encounter, "Encounter"), fhirUser: context.fhir_user ?? undefined, fhirSource: context.fhir_source ?? undefined, fhirBaseUrl: context.fhir_base_url ?? undefined });
    return new Response(null, { status: 302, headers: { Location: `/patients/${encodeURIComponent(resourceId(context.patient, "Patient")!)}`, "Set-Cookie": buildSessionCookie(token), "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The Medblocks launch could not be resolved." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function handleExtendSession(req: Request): Promise<Response> {
  const session = getSessionFromRequest(req);
  if (!session) return unauthorizedResponse();
  const token = session.mode === "ehr" ? createEhrSessionToken({ patientId: session.patientId!, encounterId: session.encounterId, fhirUser: session.fhirUser, fhirSource: session.fhirSource, fhirBaseUrl: session.fhirBaseUrl }) : createDemoSessionToken(session.role);
  const user = DEMO_USERS[session.role];
  const renewed = verifySessionToken(token);
  return Response.json(
    {
      authenticated: true,
      user: { email: session.email, displayName: session.displayName, role: session.role, patientId: session.patientId, mode: session.mode, encounterId: session.encounterId, fhirUser: session.fhirUser, fhirSource: session.fhirSource, fhirBaseUrl: session.fhirBaseUrl },
      expiresAt: renewed?.exp,
    },
    { status: 200, headers: { "Set-Cookie": buildSessionCookie(token), "Cache-Control": "no-store" } },
  );
}

export async function handleCreatePatient(req: Request): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let input: Partial<PatientFormInput>;
  try {
    input = (await req.json()) as Partial<PatientFormInput>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validatePatientInput(input);
  if (errors.length > 0) return Response.json(validationErrorOutcome(errors), { status: 422 });

  const identifierValue = input.identifier?.trim() || crypto.randomUUID();

  if (input.identifier?.trim()) {
    const existing = await searchFhirResource<fhir4.Bundle>(
      "Patient",
      `identifier=${encodeURIComponent(`https://nephra.demo/patient-id|${identifierValue}`)}`,
    );
    if (existing.status === 200 && existing.body?.total && existing.body.total > 0) {
      return Response.json(
        { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "duplicate", diagnostics: "A patient with this identifier already exists." }] },
        { status: 409 },
      );
    }
  }

  const resource = buildPatientResource(input as PatientFormInput, identifierValue);
  const result = await createFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", resource);

  if (result.status !== 201) return Response.json(result.body, { status: result.status });

  const createdId = (isOperationOutcome(result.body) ? null : result.body.id) ?? extractIdFromLocation(result.location);
  return Response.json({ ...result.body, id: createdId }, { status: 201 });
}

export async function handleUpdatePatient(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let input: Partial<PatientFormInput>;
  try {
    input = (await req.json()) as Partial<PatientFormInput>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const errors = validatePatientInput(input);
  if (errors.length > 0) return Response.json(validationErrorOutcome(errors), { status: 422 });

  const current = await readFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId);
  if (current.status !== 200 || isOperationOutcome(current.body)) {
    return Response.json(current.body, { status: current.status });
  }

  const merged = mergePatientResource(current.body, input as PatientFormInput);
  const ifMatch = req.headers.get("if-match") ?? current.etag ?? undefined;
  const result = await updateFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId, merged, ifMatch);

  if (result.status === 409) {
    return Response.json(
      { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "conflict", diagnostics: "This patient was updated by another process. Refresh and try again." }] },
      { status: 409 },
    );
  }

  return Response.json(result.body, { status: result.status });
}

export async function handleDeactivatePatient(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const current = await readFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId);
  if (current.status !== 200 || isOperationOutcome(current.body)) {
    return Response.json(current.body, { status: current.status });
  }

  const deactivated: fhir4.Patient = { ...current.body, active: false };
  const result = await updateFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId, deactivated, current.etag ?? undefined);

  return Response.json(result.body, { status: result.status });
}

export async function handleClinicianWorklist(req: Request): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const worklist = await buildClinicianWorklist();
    return Response.json(worklist, { status: 200 });
  } catch (error) {
    console.error("Failed to build clinician worklist:", error instanceof Error ? error.message : "unknown error");
    return networkErrorResponse();
  }
}

export async function handleNurseMntWorklist(req: Request): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const worklist = await buildNurseMntWorklist();
    return Response.json(worklist, { status: 200 });
  } catch (error) {
    console.error("Failed to build MNT worklist:", error instanceof Error ? error.message : "unknown error");
    return networkErrorResponse();
  }
}

export async function handleTranscribeHomeHealthVisit(req: Request, visitId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data audio upload." }, { status: 400 });
  }
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "An audio file is required." }, { status: 400 });
  try {
    const openai = new OpenAI({ apiKey });
    const result = await openai.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-transcribe",
      response_format: "json",
    });
    if (!result.text) return Response.json({ error: "Transcription returned no text." }, { status: 502 });
    return Response.json({ visitId, transcript: result.text, model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-transcribe", status: "completed" }, { status: 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Transcription failed." }, { status: 502 });
  }
}

export async function handleRealtimeHomeHealthVisit(req: Request, visitId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  const sdp = await req.text();
  if (!sdp.trim()) return Response.json({ error: "A WebRTC SDP offer is required." }, { status: 400 });
  const sessionConfig = {
    type: "realtime",
    model: "gpt-realtime-2.1",
    audio: {
      input: {
        transcription: { model: "gpt-live-transcribe", languages: ["en"], delay: "low" },
        turn_detection: { type: "server_vad" },
      },
    },
  };
  try {
    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(sessionConfig));
    const response = await fetch("https://api.openai.com/v1/realtime/calls", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
    const answer = await response.text();
    if (!response.ok) return new Response(answer || "Realtime session creation failed.", { status: response.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response(answer, { status: 200, headers: { "Content-Type": "application/sdp" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Realtime transcription could not start." }, { status: 502 });
  }
}

export async function handleExtractHomeHealthFindings(req: Request, visitId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "OPENAI_API_KEY is not configured on the server." }, { status: 503 });
  const parsed = await readJsonBody<{ transcript?: string; targetQuestionnaire?: string; assessment?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  if (parsed.body.targetQuestionnaire === "oasis-e2") return extractOasisCandidates(parsed.body, visitId, apiKey);
  if (!parsed.body.transcript?.trim()) return Response.json({ error: "A reviewed transcript is required." }, { status: 400 });
  const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? "gpt-4o-mini", input: [{ role: "system", content: "Extract candidate COPD home-health findings only. Never finalize clinical facts. Return JSON with findings, each having category, finding, evidenceText, and status candidate. For a patient-reported medication also return label with the medication name and doseText with the reported dose and frequency." }, { role: "user", content: parsed.body.transcript }], text: { format: { type: "json_object" } } }) });
  const body = (await response.json().catch(() => null)) as { output_text?: string; error?: { message?: string } } | null;
  if (!response.ok || !body?.output_text) return Response.json({ error: body?.error?.message ?? `Extraction failed (${response.status}).` }, { status: 502 });
  let findings: unknown;
  try { findings = JSON.parse(body.output_text); } catch { return Response.json({ error: "Extraction returned invalid structured output." }, { status: 502 }); }
  return Response.json({ visitId, status: "candidate", findings }, { status: 200 });
}

export async function handleConfirmHomeHealthFinding(req: Request, visitId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const parsed = await readJsonBody<{ patientId?: string; kind?: "spo2" | "respiratory-rate" | "medication-not-taking" | "medication-taking"; value?: string; doseText?: string; medicationRequestId?: string; reason?: string; evidenceText?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const input = parsed.body;
  if (!input.patientId || !input.kind || !input.value) return Response.json({ error: "patientId, kind, and value are required." }, { status: 400 });
  const target = `Patient/${input.patientId}`;
  if (input.kind === "medication-taking") {
    // A newly discovered home medication is patient-reported use, never a prescription.
    const statement = await createMedicationStatement({ patientId: input.patientId, medicationText: input.value, status: "active", reportedUse: "taking", doseText: input.doseText, note: `${input.reason ?? "Patient-reported medication documented during a home-health visit"}. Evidence: ${input.evidenceText ?? ""}`, actorDisplay: session.displayName });
    if (!statement.ok) return Response.json({ error: statement.error }, { status: statement.status });
    return Response.json({ ok: true, resourceType: "MedicationStatement", id: statement.id, visitId }, { status: 201 });
  }
  if (input.kind === "medication-not-taking") {
    // Re-confirming the same finding must not create another statement, which would fan out into a duplicate DetectedIssue and Task.
    const existing = await searchFhirResource<fhir4.Bundle>("MedicationStatement", `patient=${encodeURIComponent(input.patientId)}&_count=100`);
    const today = new Date().toISOString().slice(0, 10);
    const duplicate = (existing.body?.entry ?? [])
      .map(entry => entry.resource)
      .filter((resource): resource is fhir4.MedicationStatement => resource?.resourceType === "MedicationStatement")
      .find(
        resource =>
          resource.status === "not-taken" &&
          resource.dateAsserted?.slice(0, 10) === today &&
          (input.medicationRequestId
            ? resource.basedOn?.some((reference: fhir4.Reference) => reference.reference === `MedicationRequest/${input.medicationRequestId}`) === true
            : resource.medicationCodeableConcept?.text === input.value),
      );
    if (duplicate?.id) return Response.json({ ok: true, resourceType: "MedicationStatement", id: duplicate.id, visitId, deduplicated: true }, { status: 200 });
    const statement = await createMedicationStatement({ patientId: input.patientId, medicationRequestId: input.medicationRequestId, medicationText: input.value, status: "not-taken", note: `${input.reason ?? "Patient reported not taking"}. Evidence: ${input.evidenceText ?? ""}`, actorDisplay: session.displayName });
    if (!statement.ok) return Response.json({ error: statement.error }, { status: statement.status });
    return Response.json({ ok: true, resourceType: "MedicationStatement", id: statement.id, visitId }, { status: 201 });
  }
  const code = input.kind === "spo2" ? { system: "http://loinc.org", code: "59408-5", display: "Oxygen saturation in arterial blood by pulse oximetry" } : { system: "http://loinc.org", code: "9279-1", display: "Respiratory rate" };
  const observation: fhir4.Observation = { resourceType: "Observation", identifier: [{ system: "https://waypoint.example/fhir/identifier/home-health", value: `${visitId}-${input.kind}-${new Date().toISOString().slice(0, 10)}` }], status: "final", code: { coding: [code], text: code.display }, subject: { reference: target }, effectiveDateTime: new Date().toISOString(), valueQuantity: { value: Number(input.value), unit: input.kind === "spo2" ? "%" : "breaths/min", system: "http://unitsofmeasure.org" }, note: [{ text: `Confirmed by ${session.displayName}. Evidence: ${input.evidenceText ?? ""}` }] };
  const created = await createFhirResource<fhir4.Observation | fhir4.OperationOutcome>("Observation", observation);
  if (created.status !== 201 || isOperationOutcome(created.body)) return Response.json({ error: "Unable to save confirmed observation." }, { status: created.status });
  return Response.json({ ok: true, resourceType: "Observation", id: created.body.id, visitId }, { status: 201 });
}

function mntActionResponse(result: MntActionResult): Response {
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.referral, { status: 200 });
}

export async function handleGetMntState(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const patientResult = await readFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId);
  if (patientResult.status !== 200 || isOperationOutcome(patientResult.body)) {
    return Response.json(patientResult.body, { status: patientResult.status });
  }

  const [conditionsResult, observationsResult] = await Promise.all([
    searchFhirResource<fhir4.Bundle>("Condition", `patient=${encodeURIComponent(patientId)}`),
    searchFhirResource<fhir4.Bundle>("Observation", `patient=${encodeURIComponent(patientId)}`),
  ]);

  const conditions = (conditionsResult.body?.entry ?? [])
    .map(entry => entry.resource)
    .filter((r): r is fhir4.Condition => !!r && r.resourceType === "Condition")
    .filter(condition => referencesPatient(condition.subject, patientId));
  const observations = (observationsResult.body?.entry ?? [])
    .map(entry => entry.resource)
    .filter((r): r is fhir4.Observation => !!r && r.resourceType === "Observation")
    .filter(observation => referencesPatient(observation.subject, patientId));

  const state = await getPatientMntState(patientResult.body, conditions, observations);
  return Response.json(state, { status: 200 });
}

export async function handleCreateMntReferral(req: Request): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: {
    patientId?: string;
    reasonDisplay?: string;
    reasonReferenceId?: string;
    reasonReferenceType?: "Condition" | "Observation";
    supportingObservationIds?: string[];
    willingness?: PatientWillingness;
    barriers?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.patientId || !body.reasonDisplay) {
    return Response.json({ error: "patientId and reasonDisplay are required." }, { status: 400 });
  }

  const result = await createDraftReferral({
    patientId: body.patientId,
    reasonReference: body.reasonReferenceId
      ? { reference: `${body.reasonReferenceType ?? "Condition"}/${body.reasonReferenceId}`, display: body.reasonDisplay }
      : { display: body.reasonDisplay },
    supportingInfo: (body.supportingObservationIds ?? []).map(id => ({ reference: `Observation/${id}` })),
    willingness: body.willingness ?? "unknown",
    barriers: body.barriers ?? [],
    preparedByDisplay: session.displayName,
  });

  return mntActionResponse(result);
}

export async function handleSendForSignature(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "nurse");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const result = await sendForSignature({ serviceRequestId, nurseDisplay: session.displayName });
  return mntActionResponse(result);
}

export async function handleSignMntReferral(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can sign this referral.") : unauthorizedResponse();

  let body: { dietitianDisplay?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine
  }

  const result = await signReferral({ serviceRequestId, clinicianDisplay: session.displayName, dietitianDisplay: body.dietitianDisplay });
  return mntActionResponse(result);
}

export async function handleDeclineMntReferral(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can decline this referral.") : unauthorizedResponse();

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.reason) return Response.json({ error: "A decline reason is required." }, { status: 400 });

  const result = await declineReferral({ serviceRequestId, reason: body.reason, clinicianDisplay: session.displayName });
  return mntActionResponse(result);
}

export async function handleModifyMntReferral(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can modify this referral.") : unauthorizedResponse();

  let body: { reasonText?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await modifyReferral({ serviceRequestId, reasonText: body.reasonText, clinicianDisplay: session.displayName });
  return mntActionResponse(result);
}

export async function handleDocumentBarrier(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "nurse");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: { barrier?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.barrier) return Response.json({ error: "A barrier description is required." }, { status: 400 });

  const result = await documentBarrier({ serviceRequestId, barrier: body.barrier, nurseDisplay: session.displayName });
  return mntActionResponse(result);
}

export async function handleContactPatient(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "nurse");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: { outcome?: "reached" | "no-response" | "declined-appointment"; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.outcome) return Response.json({ error: "An outcome is required." }, { status: 400 });

  const result = await contactPatient({ serviceRequestId, outcome: body.outcome, note: body.note, nurseDisplay: session.displayName });
  return mntActionResponse(result);
}

export async function handleCoordinateScheduling(req: Request, serviceRequestId: string): Promise<Response> {
  const session = requireRole(req, "nurse");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: { appointmentDate?: string; dietitianDisplay?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await coordinateScheduling({
    serviceRequestId,
    appointmentDate: body.appointmentDate,
    dietitianDisplay: body.dietitianDisplay,
    nurseDisplay: session.displayName,
  });
  return mntActionResponse(result);
}

// ---------------------------------------------------------------------------
// Medication management
// ---------------------------------------------------------------------------

function medicationActionResponse(result: MedicationActionResult): Response {
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.medicationRequest, { status: 200 });
}

export async function handleGetMedicationState(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const patientResult = await readFhirResource<fhir4.Patient | fhir4.OperationOutcome>("Patient", patientId);
  if (patientResult.status !== 200 || isOperationOutcome(patientResult.body)) {
    return Response.json(patientResult.body, { status: patientResult.status });
  }

  const conditionsResult = await searchFhirResource<fhir4.Bundle>("Condition", `patient=${encodeURIComponent(patientId)}`);
  const conditions = (conditionsResult.body?.entry ?? [])
    .map(e => e.resource)
    .filter((r): r is fhir4.Condition => !!r && r.resourceType === "Condition")
    .filter(c => referencesPatient(c.subject, patientId));

  const state = await getPatientMedicationState(patientResult.body, conditions);
  return Response.json(state, { status: 200 });
}

export async function handleCreateMedicationDraft(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can create a medication order.") : unauthorizedResponse();

  let body: Partial<CreateDraftMedicationInput>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.medicationText) return Response.json({ error: "medicationText is required." }, { status: 400 });

  const result = await createDraftMedicationRequest({ ...body, medicationText: body.medicationText, patientId, prescriberDisplay: session.displayName });
  return medicationActionResponse(result);
}

export async function handleSignMedicationRequest(req: Request, id: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can sign a medication order.") : unauthorizedResponse();

  const result = await signMedicationRequest(id, session.displayName);
  return medicationActionResponse(result);
}

export async function handleHoldMedicationRequest(req: Request, id: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can pause a medication order.") : unauthorizedResponse();

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.reason) return Response.json({ error: "A hold reason is required." }, { status: 400 });

  const result = await holdMedicationRequest(id, body.reason, session.displayName);
  return medicationActionResponse(result);
}

export async function handleStopMedicationRequest(req: Request, id: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can stop a medication order.") : unauthorizedResponse();

  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.reason) return Response.json({ error: "A stop reason is required." }, { status: 400 });

  const result = await stopMedicationRequest(id, body.reason, session.displayName);
  return medicationActionResponse(result);
}

export async function handleReplaceMedicationRequest(req: Request, id: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can replace a medication order.") : unauthorizedResponse();

  let body: Partial<CreateDraftMedicationInput>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await replaceMedicationRequest(id, body, session.displayName);
  return medicationActionResponse(result);
}

export async function handleCreateMedicationStatement(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: { medicationRequestId?: string; medicationText?: string; status?: fhir4.MedicationStatement["status"]; doseText?: string; note?: string; reportedUse?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.medicationText || !body.status) return Response.json({ error: "medicationText and status are required." }, { status: 400 });

  const result = await createMedicationStatement({
    patientId,
    medicationRequestId: body.medicationRequestId,
    medicationText: body.medicationText,
    status: body.status,
    doseText: body.doseText,
    note: body.note,
    reportedUse: body.reportedUse,
    actorDisplay: session.displayName,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ id: result.id, cdsWarning: result.cdsWarning }, { status: 201 });
}

export async function handleCreateMedicationAssessment(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: { answers?: SymptomAnswerInput[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.answers || body.answers.length === 0) return Response.json({ error: "At least one symptom answer is required." }, { status: 400 });

  const result = await createMedicationAssessment({ patientId, answers: body.answers, actorDisplay: session.displayName });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ id: result.id }, { status: 201 });
}

export async function handleResolveDetectedIssue(req: Request, id: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can resolve a medication safety conflict.") : unauthorizedResponse();

  let body: { action?: "modify" | "cancel" | "continue" | "create-task"; reason?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.action || !body.reason) return Response.json({ error: "action and reason are required." }, { status: 400 });

  const result = await resolveDetectedIssue({ id, action: body.action, reason: body.reason, actorDisplay: session.displayName });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true }, { status: 200 });
}

export async function handleMedicationSafetyEvaluate(req: Request): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  let body: CdsHooksRequestBody & { patientId?: string; draftMedicationRequest?: fhir4.MedicationRequest };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patientId = body.patientId ?? body.context?.patientId;
  const draft = body.draftMedicationRequest;
  if (!patientId || !draft) return Response.json({ error: "patientId and draftMedicationRequest are required." }, { status: 400 });

  const evaluation = await evaluateMedicationSafety(patientId, [draft]);
  const persisted = await persistDetectedIssuesFromEvaluation(patientId, evaluation);
  return Response.json({ ...cdsHooksResponse(evaluation), conflicts: persisted }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Kidney services directory
// ---------------------------------------------------------------------------

function fhirJsonResponse(resource: fhir4.Resource): Response {
  return new Response(JSON.stringify(resource, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/fhir+json" },
  });
}

function directoryReadError(error: unknown): Response {
  console.error("Kidney services directory read failed:", error instanceof Error ? error.message : "unknown error");
  return Response.json({ error: "Kidney services data has not been generated. Run bun run import:kidney-services." }, { status: 500 });
}

export async function handleKidneyTransplantPrograms(req: Request): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const parsed = parseKidneyServiceSearchParams(new URL(req.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const programs = await getKidneyTransplantPrograms();
    return Response.json(searchTransplantPrograms(programs, parsed.options), { status: 200 });
  } catch (error) {
    return directoryReadError(error);
  }
}

export async function handleKidneyTransplantProgram(req: Request, centerCode: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const program = await getKidneyTransplantProgram(decodeURIComponent(centerCode));
    if (!program) return Response.json({ error: "Kidney transplant program not found." }, { status: 404 });
    return Response.json(program, { status: 200 });
  } catch (error) {
    return directoryReadError(error);
  }
}

export async function handleKidneyTransplantProgramFhir(req: Request, centerCode: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const program = await getKidneyTransplantProgram(decodeURIComponent(centerCode));
    if (!program) return Response.json({ error: "Kidney transplant program not found." }, { status: 404 });
    return fhirJsonResponse(createFhirDirectoryBundle(program));
  } catch (error) {
    return directoryReadError(error);
  }
}

export async function handleDialysisFacilities(req: Request): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const parsed = parseDialysisSearchParams(new URL(req.url).searchParams);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const facilities = await getDialysisFacilities();
    return Response.json(searchDialysisFacilities(facilities, parsed.options), { status: 200 });
  } catch (error) {
    return directoryReadError(error);
  }
}

export async function handleDialysisFacility(req: Request, facilityId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const facility = await getDialysisFacility(decodeURIComponent(facilityId));
    if (!facility) return Response.json({ error: "Dialysis facility not found." }, { status: 404 });
    return Response.json(facility, { status: 200 });
  } catch (error) {
    return directoryReadError(error);
  }
}

export async function handleDialysisFacilityFhir(req: Request, facilityId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  try {
    const facility = await getDialysisFacility(decodeURIComponent(facilityId));
    if (!facility) return Response.json({ error: "Dialysis facility not found." }, { status: 404 });
    return fhirJsonResponse(createFhirDirectoryBundle(facility));
  } catch (error) {
    return directoryReadError(error);
  }
}

// ---------------------------------------------------------------------------
// Clinical notes, coding review, prior authorization readiness, and SDOH referrals
// ---------------------------------------------------------------------------

async function readJsonBody<T>(req: Request): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, body: (await req.json()) as T };
  } catch {
    return { ok: false, response: Response.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

export async function handleCreateClinicalNoteDraft(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can save clinical-note coding drafts.") : unauthorizedResponse();

  const parsed = await readJsonBody<SaveClinicalNoteInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createClinicalNoteDraft(patientId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.draft, { status: 201 });
}

export async function handleAnalyzeClinicalNote(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can analyze notes for clinical coding.") : unauthorizedResponse();

  const parsed = await readJsonBody<AnalyzeClinicalNoteInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await analyzeClinicalNote(patientId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.response, { status: 200 });
}

export async function handleSaveClinicalNoteDraft(req: Request, draftId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can save clinical-note coding drafts.") : unauthorizedResponse();

  const parsed = await readJsonBody<SaveClinicalNoteInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await saveClinicalNoteDraft(draftId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.draft, { status: 200 });
}

export async function handleApproveClinicalConcept(req: Request, draftId: string, conceptId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can approve coding suggestions.") : unauthorizedResponse();

  const parsed = await readJsonBody<ApproveConceptInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await approveClinicalConcept(draftId, conceptId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.response, { status: 200 });
}

export async function handleRejectClinicalConcept(req: Request, draftId: string, conceptId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can reject coding suggestions.") : unauthorizedResponse();

  const parsed = await readJsonBody<RejectConceptInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await rejectClinicalConcept(draftId, conceptId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.response, { status: 200 });
}

export async function handleFinalizeClinicalNote(req: Request, draftId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can finalize clinical-note coding drafts.") : unauthorizedResponse();

  const result = await finalizeClinicalNoteDraft(draftId, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.draft, { status: 200 });
}

export async function handlePriorAuthReadiness(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const draftId = new URL(req.url).searchParams.get("draftId");
  let draft;
  if (draftId) {
    const loaded = await loadClinicalNoteDraft(draftId);
    if (!loaded.ok) return Response.json({ error: loaded.error }, { status: loaded.status });
    if (loaded.draft.patientId !== patientId) return Response.json({ error: "Draft does not belong to this patient." }, { status: 409 });
    draft = loaded.draft;
  }
  const readiness = await buildPriorAuthReadiness(patientId, draft);
  return Response.json(readiness, { status: 200 });
}

export async function handleConfirmPriorAuthEvidence(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can confirm prior-authorization evidence.") : unauthorizedResponse();

  const parsed = await readJsonBody<{ draftId?: string; rationale?: string }>(req);
  if (!parsed.ok) return parsed.response;
  const draftId = parsed.body.draftId;
  if (!draftId) return Response.json({ error: "draftId is required." }, { status: 400 });
  const loaded = await loadClinicalNoteDraft(draftId);
  if (!loaded.ok) return Response.json({ error: loaded.error }, { status: loaded.status });
  if (loaded.draft.patientId !== patientId) return Response.json({ error: "Draft does not belong to this patient." }, { status: 409 });

  const readiness = await buildPriorAuthReadiness(patientId, loaded.draft);
  return Response.json({ ok: true, rationale: parsed.body.rationale ?? readiness.reasonForEscalation, readiness }, { status: 200 });
}

export async function handleCreatePriorAuthTask(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const parsed = await readJsonBody<CreatePriorAuthTaskInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createPatientTask(patientId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ taskId: result.taskId }, { status: 201 });
}

export async function handleCreateSdohReferralDraft(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const parsed = await readJsonBody<SdohReferralDraftInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createSdohReferralDraft(patientId, parsed.body, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.referral, { status: 201 });
}

export async function handleApproveSdohReferralDraft(req: Request, referralDraftId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can approve community referral drafts.") : unauthorizedResponse();

  const parsed = await readJsonBody<{ createFollowUpTask?: boolean }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await approveSdohReferralDraft(referralDraftId, session.displayName, parsed.body.createFollowUpTask === true);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result, { status: 200 });
}

export async function handleCancelSdohReferralDraft(req: Request, referralDraftId: string): Promise<Response> {
  const session = requireRole(req, "nurse", "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();

  const result = await cancelSdohReferralDraft(referralDraftId, session.displayName);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true }, { status: 200 });
}

// ---------------------------------------------------------------------------
// Patient-specific care coordination
// ---------------------------------------------------------------------------

function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function handleGetCareCoordination(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  try {
    const raw = await loadCareCoordinationData(patientId);
    return noStoreJson(buildCareCoordinationPlan(raw));
  } catch {
    return noStoreJson({ error: "Care-coordination data could not be retrieved." }, 502);
  }
}

export async function handleCareCoordinationProposals(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  try {
    const raw = await loadCareCoordinationData(patientId);
    const model = buildCareCoordinationPlan(raw);
    return noStoreJson({
      proposals: model.pathways.filter(pathway => pathway.requiresClinicianApproval),
      insufficientEvidence: model.dataStatus.insufficientEvidence,
    });
  } catch {
    return noStoreJson({ error: "Care-coordination proposals could not be evaluated." }, 502);
  }
}

export async function handlePreviewCareCoordinationReferral(req: Request, patientId: string): Promise<Response> {
  const session = requireStaff(req);
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const parsed = await readJsonBody<ReferralActionBody>(req);
  if (!parsed.ok) return parsed.response;
  const result = await previewCareCoordinationReferral(patientId, session.displayName, parsed.body);
  return result.ok ? noStoreJson(result.preview) : noStoreJson({ error: result.error }, result.status);
}

export async function handleConfirmCareCoordinationReferral(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) {
    return getSessionFromRequest(req)
      ? forbiddenResponse("Only an authorized clinician can approve and submit a referral.")
      : unauthorizedResponse();
  }
  const parsed = await readJsonBody<ReferralActionBody>(req);
  if (!parsed.ok) return parsed.response;
  const result = await confirmCareCoordinationReferral(patientId, session.displayName, parsed.body);
  if (!result.ok) return noStoreJson({ error: result.error }, result.status);
  return noStoreJson({ ok: true, response: result.responseBundle }, 201);
}

export async function handleUpdateCareCoordinationTask(req: Request, patientId: string, taskId: string): Promise<Response> {
  const session = requireStaff(req);
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const parsed = await readJsonBody<TaskActionBody>(req);
  if (!parsed.ok) return parsed.response;
  const result = await updateCoordinationTask(patientId, taskId, session.displayName, parsed.body);
  return result.ok ? noStoreJson(result.task) : noStoreJson({ error: result.error }, result.status);
}

export async function handleCreateCareCoordinationCommunication(req: Request, patientId: string): Promise<Response> {
  const session = requireStaff(req);
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const parsed = await readJsonBody<{
    recipientReference?: string;
    recipientDisplay?: string;
    subject?: string;
    message?: string;
  }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createCoordinationCommunication(patientId, session.displayName, parsed.body);
  return result.ok ? noStoreJson(result.communication, 201) : noStoreJson({ error: result.error }, result.status);
}

export async function handleGetCareCoordinationTimeline(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  try {
    const raw = await loadCareCoordinationData(patientId);
    return noStoreJson({ timeline: buildCareCoordinationPlan(raw).timeline });
  } catch {
    return noStoreJson({ error: "The coordination timeline could not be retrieved." }, 502);
  }
}

export async function handleGetSleSystemsReview(req: Request, patientId: string): Promise<Response> {
  if (!requireStaff(req)) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  try {
    return noStoreJson(buildSleSystemsReviewModel(await loadSleSystemsReviewData(patientId)));
  } catch {
    return noStoreJson({ error: "The patient-specific SLE systems review could not be retrieved." }, 502);
  }
}

export async function handleSubmitSleSystemAssessment(req: Request, patientId: string): Promise<Response> {
  const session = requireRole(req, "clinician");
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse("Only an authorized clinician can complete a structured SLE assessment.") : unauthorizedResponse();
  const parsed = await readJsonBody<SubmitSleAssessmentInput>(req);
  if (!parsed.ok) return parsed.response;
  const result = await submitSleSystemAssessment(patientId, parsed.body, session.displayName);
  if (!result.ok) return noStoreJson({ error: result.error }, result.status);
  return noStoreJson({ ok: true, questionnaireResponseId: result.response.id }, 201);
}

export async function handleCreateSleSystemTask(req: Request, patientId: string): Promise<Response> {
  const session = requireStaff(req);
  if (!session) return getSessionFromRequest(req) ? forbiddenResponse() : unauthorizedResponse();
  const parsed = await readJsonBody<{ systemId?: unknown; description?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createSleSystemReviewTask(patientId, parsed.body.systemId, parsed.body.description, session.displayName);
  if (!result.ok) return noStoreJson({ error: result.error }, result.status);
  return noStoreJson({ taskId: result.taskId }, 201);
}

// ---------------------------------------------------------------------------
// Patient portal: patient identity is always resolved from the signed session.
// ---------------------------------------------------------------------------

type PortalSection =
  | "summary"
  | "lupus"
  | "labs"
  | "nutrition"
  | "care-plan"
  | "appointments"
  | "medications"
  | "care-team"
  | "messages"
  | "documents";

function portalAccessError(req: Request): Response {
  return getSessionFromRequest(req) ? forbiddenResponse("This route requires an authorized patient session.") : unauthorizedResponse();
}

export async function handleGetPortalSection(req: Request, section: PortalSection, resultId?: string): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  try {
    const model = buildPatientPortalModel(await loadPatientPortalData(session.patientId));
    if (section === "summary") return noStoreJson({ patient: model.patient, dashboard: model.dashboard, dataStatus: model.dataStatus });
    if (section === "lupus") return noStoreJson({ error: "This patient portal section is no longer available." }, 404);
    if (section === "labs") {
      if (!resultId) return noStoreJson({ patient: model.patient, results: model.labs, dataStatus: model.dataStatus });
      const result = model.labs.find(item => item.id === resultId);
      return result ? noStoreJson({ patient: model.patient, result, dataStatus: model.dataStatus }) : noStoreJson({ error: "Lab result not found." }, 404);
    }
    if (section === "nutrition") return noStoreJson({ patient: model.patient, guidance: model.nutrition, mealIdeas: model.mealIdeas, carePlan: model.carePlan, careTeam: model.careTeam, dataStatus: model.dataStatus });
    if (section === "care-plan") return noStoreJson({ patient: model.patient, pathways: model.carePlan, dataStatus: model.dataStatus });
    if (section === "appointments") return noStoreJson({ patient: model.patient, appointments: model.appointments, dataStatus: model.dataStatus });
    if (section === "medications") return noStoreJson({ patient: model.patient, medications: model.medications, dataStatus: model.dataStatus });
    if (section === "care-team") return noStoreJson({ patient: model.patient, members: model.careTeam, dataStatus: model.dataStatus });
    if (section === "messages") return noStoreJson({ patient: model.patient, messages: model.messages, dataStatus: model.dataStatus });
    return noStoreJson({ patient: model.patient, documents: model.documents, dataStatus: model.dataStatus });
  } catch {
    return noStoreJson({ error: "We could not load this part of your record." }, 502);
  }
}

export async function handlePortalAppointmentChangeRequest(req: Request): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  const parsed = await readJsonBody<{ appointmentId?: unknown; requestType?: unknown; message?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createAppointmentChangeRequest(session.patientId, parsed.body);
  return result.ok ? noStoreJson({ ok: true, requestId: result.resource.id }, 201) : noStoreJson({ error: result.error }, result.status);
}

export async function handlePortalRefillRequest(req: Request): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  const parsed = await readJsonBody<{ medicationRequestId?: unknown; message?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createRefillRequest(session.patientId, parsed.body);
  return result.ok ? noStoreJson({ ok: true, requestId: result.resource.id }, 201) : noStoreJson({ error: result.error }, result.status);
}

export async function handlePortalNutritionSupportRequest(req: Request): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  const parsed = await readJsonBody<{ topic?: unknown; message?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createNutritionSupportRequest(session.patientId, parsed.body);
  return result.ok ? noStoreJson({ ok: true, requestId: result.resource.id }, 201) : noStoreJson({ error: result.error }, result.status);
}

export async function handlePortalCreateMessage(req: Request): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  const parsed = await readJsonBody<{ category?: unknown; subject?: unknown; message?: unknown }>(req);
  if (!parsed.ok) return parsed.response;
  const result = await createPatientPortalMessage(session.patientId, parsed.body);
  return result.ok ? noStoreJson({ ok: true, messageId: result.resource.id }, 201) : noStoreJson({ error: result.error }, result.status);
}

export async function handlePortalReport(req: Request): Promise<Response> {
  const session = requirePatient(req);
  if (!session?.patientId) return portalAccessError(req);
  try {
    const model = buildPatientPortalModel(await loadPatientPortalData(session.patientId));
    const lines = [
      "Waypoint patient-friendly care summary",
      `Patient: ${model.patient.displayName}`,
      `Report date: ${new Date().toLocaleDateString("en-US")}`,
      "",
      "Information from your medical record",
      ...model.labs.slice(0, 8).map(result => `${result.plainLanguageName}: ${result.value ?? "Not available"}${result.unit ? ` ${result.unit}` : ""} (${result.date ?? "date unavailable"})`),
      "",
      "Upcoming next steps",
      ...(model.dashboard.today.length ? model.dashboard.today.map(step => `- ${step.title}: ${step.status}`) : ["- No action is currently listed in the available care plan."]),
      "",
      "Upcoming appointments",
      ...(model.appointments.filter(item => !item.past).length
        ? model.appointments.filter(item => !item.past).map(item => `- ${item.title}: ${item.start ?? "Scheduling in progress"}`)
        : ["- No upcoming appointment is available in this record."]),
      "",
      "Current medications",
      ...model.medications.filter(item => item.status === "active").map(item => `- ${item.name}${item.dose ? `, ${item.dose}` : ""}${item.frequency ? `, ${item.frequency}` : ""}`),
      "",
      "General education and safety",
      "This summary does not replace medical advice. Do not change medicines or diet restrictions without speaking with your care team.",
      `Source updated: ${model.dataStatus.lastUpdatedAt}`,
      model.patient.synthetic ? "Synthetic demonstration data; not a real patient record." : "",
    ].filter(Boolean);
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="luppedin-care-summary.txt"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return noStoreJson({ error: "The report could not be generated." }, 502);
  }
}

export async function handleCdsDiscovery(): Promise<Response> {
  return Response.json(CDS_SERVICES_DISCOVERY, { status: 200 });
}
