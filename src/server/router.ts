/**
 * The single, central request router — used identically by both deployment
 * targets (Bun.serve() locally/Docker, and the one Vercel serverless function
 * under /api). All actual business logic lives in ./handlers.ts; this file
 * only does URL/method matching and dispatch, so there is exactly one
 * implementation of every route, never two.
 */
import { handleCopdHook, handleCopdPatientSupport } from "./copd-cds-handlers";
import {
  handleClinicianWorklist,
  handleContactPatient,
  handleCoordinateScheduling,
  handleCreateMntReferral,
  handleCreatePatient,
  handleDeactivatePatient,
  handleDeclineMntReferral,
  handleDemoLogin,
  handleMedblocksLaunch,
  handleDocumentBarrier,
  handleGetMntState,
  handleLogout,
  handleModifyMntReferral,
  handleNurseMntWorklist,
  handleSendForSignature,
  handleSession,
  handleExtendSession,
  handleSignMntReferral,
  handleUpdatePatient,
  proxyFhirRequest,
  handleGetMedicationState,
  handleDialysisFacilities,
  handleDialysisFacility,
  handleDialysisFacilityFhir,
  handleKidneyTransplantProgram,
  handleKidneyTransplantProgramFhir,
  handleKidneyTransplantPrograms,
  handleCreateMedicationDraft,
  handleSignMedicationRequest,
  handleHoldMedicationRequest,
  handleStopMedicationRequest,
  handleReplaceMedicationRequest,
  handleCreateMedicationStatement,
  handleCreateMedicationAssessment,
  handleResolveDetectedIssue,
  handleMedicationSafetyEvaluate,
  handleAnalyzeClinicalNote,
  handleApproveClinicalConcept,
  handleApproveSdohReferralDraft,
  handleCancelSdohReferralDraft,
  handleCdsDiscovery,
  handleConfirmPriorAuthEvidence,
  handleCreateClinicalNoteDraft,
  handleCreatePriorAuthTask,
  handleCreateSdohReferralDraft,
  handleFinalizeClinicalNote,
  handlePriorAuthReadiness,
  handleRejectClinicalConcept,
  handleSaveClinicalNoteDraft,
  handleCareCoordinationProposals,
  handleConfirmCareCoordinationReferral,
  handleCreateCareCoordinationCommunication,
  handleGetCareCoordination,
  handleGetCareCoordinationTimeline,
  handlePreviewCareCoordinationReferral,
  handleUpdateCareCoordinationTask,
  handleGetPortalSection,
  handlePortalAppointmentChangeRequest,
  handlePortalCreateMessage,
  handlePortalNutritionSupportRequest,
  handlePortalRefillRequest,
  handlePortalReport,
  handleGetSleSystemsReview,
  handleSubmitSleSystemAssessment,
  handleCreateSleSystemTask,
  handleTranscribeHomeHealthVisit,
  handleRealtimeHomeHealthVisit,
  handleExtractHomeHealthFindings,
  handleConfirmHomeHealthFinding,
} from "./handlers.js";

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

const CDS_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/** Clones a Response with CORS headers added, so an external CDS Hooks sandbox can call these endpoints cross-origin. */
function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CDS_CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Discovery advertises the first id of each hook; the `waypoint-copd-*` ids stay routable for already-registered CDS clients. */
const COPD_CDS_SERVICES = {
  "waypoint-patient-view": "patient-view",
  "waypoint-copd-patient-view": "patient-view",
  "waypoint-order-select": "order-select",
  "waypoint-copd-order-select": "order-select",
  "waypoint-order-sign": "order-sign",
  "waypoint-copd-order-sign": "order-sign",
} as const;

const MNT_REFERRAL_ACTIONS = {
  "send-for-signature": handleSendForSignature,
  sign: handleSignMntReferral,
  decline: handleDeclineMntReferral,
  modify: handleModifyMntReferral,
  barrier: handleDocumentBarrier,
  contact: handleContactPatient,
  schedule: handleCoordinateScheduling,
} as const;

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method.toUpperCase();

  if (pathname === "/launch" || pathname === "/api/launch") {
    if (method !== "GET") return jsonError("Method not allowed", 405);
    return handleMedblocksLaunch(req);
  }

  // --- FHIR proxy: preserve the full path + query string, whatever prefix it arrived under ---
  if (pathname === "/fhir" || pathname.startsWith("/fhir/")) {
    return proxyFhirRequest(req, pathname.replace(/^\/fhir/, "") || "/");
  }
  if (pathname === "/api/fhir" || pathname.startsWith("/api/fhir/")) {
    return proxyFhirRequest(req, pathname.replace(/^\/api\/fhir/, "") || "/");
  }

  // --- CDS Hooks: public path per spec (not under /api), rewritten to /api/cds-services/* on Vercel.
  // CORS is enabled here (and only here) so an external CDS Hooks sandbox can call these endpoints
  // cross-origin without our app's session cookie — see handleCopdHook for the client authentication it requires. ---
  if (pathname === "/cds-services" || pathname === "/api/cds-services") {
    if (method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (method !== "GET") return withCors(jsonError("Method not allowed", 405));
    return withCors(await handleCdsDiscovery());
  }
  if (pathname.startsWith("/cds-services/") || pathname.startsWith("/api/cds-services/")) {
    if (method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (method !== "POST") return withCors(jsonError("Method not allowed", 405));
    const serviceId = pathname.split("/").filter(Boolean).pop();
    const hook = COPD_CDS_SERVICES[serviceId as keyof typeof COPD_CDS_SERVICES];
    if (hook) return withCors(await handleCopdHook(req, hook));
    return withCors(jsonError("Not found", 404));
  }

  if (pathname !== "/api" && !pathname.startsWith("/api/")) {
    return jsonError("Not found", 404);
  }

  const segments = pathname.split("/").filter(Boolean).slice(1); // drop "api"
  if (segments.length === 3 && segments[0] === "patients" && segments[2] === "copd-decision-support") {
    if (method !== "GET" && method !== "POST") return jsonError("Method not allowed", 405);
    return handleCopdPatientSupport(req, segments[1]!);
  }

  // --- /api/health ---
  if (segments.length === 1 && segments[0] === "health") {
    if (method !== "GET") return jsonError("Method not allowed", 405);
    return Response.json({ status: "ok" }, { status: 200 });
  }

  // --- auth ---
  if (segments.length === 1 && segments[0] === "demo-login") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleDemoLogin(req);
  }
  if (segments.length === 1 && segments[0] === "logout") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleLogout();
  }
  if (segments.length === 1 && segments[0] === "session") {
    if (method !== "GET") return jsonError("Method not allowed", 405);
    return handleSession(req);
  }
  if (segments.length === 2 && segments[0] === "session" && segments[1] === "extend") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleExtendSession(req);
  }

  // --- patient portal: patient identity always comes from the signed session ---
  if (segments[0] === "portal") {
    const section = segments[1];
    if (segments.length === 2 && section === "messages" && method === "POST") {
      return handlePortalCreateMessage(req);
    }
    if (segments.length === 2 && ["summary", "lupus", "labs", "nutrition", "care-plan", "appointments", "medications", "care-team", "messages", "documents"].includes(section ?? "")) {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetPortalSection(req, section as Parameters<typeof handleGetPortalSection>[1]);
    }
    if (segments.length === 3 && section === "labs") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetPortalSection(req, "labs", segments[2]!);
    }
    if (segments.length === 3 && section === "appointments" && segments[2] === "change-request") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handlePortalAppointmentChangeRequest(req);
    }
    if (segments.length === 3 && section === "medications" && segments[2] === "refill-request") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handlePortalRefillRequest(req);
    }
    if (segments.length === 3 && section === "nutrition" && segments[2] === "request-support") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handlePortalNutritionSupportRequest(req);
    }
    if (segments.length === 3 && section === "documents" && segments[2] === "report") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handlePortalReport(req);
    }
    if (segments.length === 2 && section === "logout") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleLogout();
    }
    return jsonError("Not found", 404);
  }

  // --- worklists ---
  if (segments.length === 1 && segments[0] === "clinician-worklist") {
    if (method !== "GET") return jsonError("Method not allowed", 405);
    return handleClinicianWorklist(req);
  }
  if (segments.length === 2 && segments[0] === "nurse" && segments[1] === "mnt-worklist") {
    if (method !== "GET") return jsonError("Method not allowed", 405);
    return handleNurseMntWorklist(req);
  }
  if (segments.length === 4 && segments[0] === "home-health" && segments[1] === "visits" && segments[3] === "transcribe") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleTranscribeHomeHealthVisit(req, segments[2]!);
  }
  if (segments.length === 4 && segments[0] === "home-health" && segments[1] === "visits" && segments[3] === "realtime") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleRealtimeHomeHealthVisit(req, segments[2]!);
  }
  if (segments.length === 4 && segments[0] === "home-health" && segments[1] === "visits" && segments[3] === "extract") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleExtractHomeHealthFindings(req, segments[2]!);
  }
  if (segments.length === 4 && segments[0] === "home-health" && segments[1] === "visits" && segments[3] === "confirm") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleConfirmHomeHealthFinding(req, segments[2]!);
  }

  // --- patients ---
  if (segments[0] === "patients") {
    if (segments.length === 1) {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreatePatient(req);
    }
    if (segments.length === 2) {
      if (method !== "PUT") return jsonError("Method not allowed", 405);
      return handleUpdatePatient(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "deactivate") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleDeactivatePatient(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "care-coordination") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetCareCoordination(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "sle-systems-review") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetSleSystemsReview(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "sle-systems-review" && segments[3] === "assessments") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleSubmitSleSystemAssessment(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "sle-systems-review" && segments[3] === "tasks") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateSleSystemTask(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "care-coordination" && segments[3] === "proposals") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCareCoordinationProposals(req, segments[1]!);
    }
    if (segments.length === 5 && segments[2] === "care-coordination" && segments[3] === "referrals" && segments[4] === "preview") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handlePreviewCareCoordinationReferral(req, segments[1]!);
    }
    if (segments.length === 5 && segments[2] === "care-coordination" && segments[3] === "referrals" && segments[4] === "confirm") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleConfirmCareCoordinationReferral(req, segments[1]!);
    }
    if (segments.length === 5 && segments[2] === "care-coordination" && segments[3] === "tasks") {
      if (method !== "PATCH") return jsonError("Method not allowed", 405);
      return handleUpdateCareCoordinationTask(req, segments[1]!, segments[4]!);
    }
    if (segments.length === 4 && segments[2] === "care-coordination" && segments[3] === "communications") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateCareCoordinationCommunication(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "care-coordination" && segments[3] === "timeline") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetCareCoordinationTimeline(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "medications") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetMedicationState(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "medication-drafts") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateMedicationDraft(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "medication-statements") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateMedicationStatement(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "medication-assessments") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateMedicationAssessment(req, segments[1]!);
    }
    if (segments.length === 3 && segments[2] === "prior-auth-readiness") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handlePriorAuthReadiness(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "clinical-notes" && segments[3] === "drafts") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateClinicalNoteDraft(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "clinical-notes" && segments[3] === "analyze") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleAnalyzeClinicalNote(req, segments[1]!);
    }
    if (segments.length === 5 && segments[2] === "prior-auth" && segments[3] === "evidence" && segments[4] === "confirm") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleConfirmPriorAuthEvidence(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "prior-auth" && segments[3] === "tasks") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreatePriorAuthTask(req, segments[1]!);
    }
    if (segments.length === 4 && segments[2] === "sdoh" && segments[3] === "referral-drafts") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleCreateSdohReferralDraft(req, segments[1]!);
    }
    return jsonError("Not found", 404);
  }

  // --- clinical-note draft lifecycle ---
  if (segments[0] === "clinical-notes" && segments.length >= 3) {
    const draftId = segments[1]!;
    if (segments.length === 3 && segments[2] === "save") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleSaveClinicalNoteDraft(req, draftId);
    }
    if (segments.length === 3 && segments[2] === "finalize") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleFinalizeClinicalNote(req, draftId);
    }
    if (segments.length === 5 && segments[2] === "concepts" && segments[4] === "approve") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleApproveClinicalConcept(req, draftId, segments[3]!);
    }
    if (segments.length === 5 && segments[2] === "concepts" && segments[4] === "reject") {
      if (method !== "POST") return jsonError("Method not allowed", 405);
      return handleRejectClinicalConcept(req, draftId, segments[3]!);
    }
    return jsonError("Not found", 404);
  }

  // --- SDOH/community referral draft lifecycle ---
  if (segments[0] === "referral-drafts" && segments.length === 3) {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    if (segments[2] === "approve") return handleApproveSdohReferralDraft(req, segments[1]!);
    if (segments[2] === "cancel") return handleCancelSdohReferralDraft(req, segments[1]!);
    return jsonError("Not found", 404);
  }

  // --- medication safety review ---
  if (segments.length === 2 && segments[0] === "medication-safety" && segments[1] === "evaluate") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleMedicationSafetyEvaluate(req);
  }

  // --- kidney services directory ---
  if (segments[0] === "kidney-services") {
    if (segments.length === 2 && segments[1] === "transplant-programs") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleKidneyTransplantPrograms(req);
    }
    if (segments.length === 3 && segments[1] === "transplant-programs") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleKidneyTransplantProgram(req, segments[2]!);
    }
    if (segments.length === 4 && segments[1] === "transplant-programs" && segments[3] === "fhir") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleKidneyTransplantProgramFhir(req, segments[2]!);
    }
    if (segments.length === 2 && segments[1] === "dialysis-facilities") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleDialysisFacilities(req);
    }
    if (segments.length === 3 && segments[1] === "dialysis-facilities") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleDialysisFacility(req, segments[2]!);
    }
    if (segments.length === 4 && segments[1] === "dialysis-facilities" && segments[3] === "fhir") {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleDialysisFacilityFhir(req, segments[2]!);
    }
    return jsonError("Not found", 404);
  }

  // --- medication order actions ---
  if (segments[0] === "medication-requests" && segments.length === 3) {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    const id = segments[1]!;
    switch (segments[2]) {
      case "sign":
        return handleSignMedicationRequest(req, id);
      case "hold":
        return handleHoldMedicationRequest(req, id);
      case "stop":
        return handleStopMedicationRequest(req, id);
      case "replace":
        return handleReplaceMedicationRequest(req, id);
      default:
        return jsonError("Not found", 404);
    }
  }

  // --- detected issue review ---
  if (segments[0] === "detected-issues" && segments.length === 3 && segments[2] === "resolve") {
    if (method !== "POST") return jsonError("Method not allowed", 405);
    return handleResolveDetectedIssue(req, segments[1]!);
  }

  // --- medical nutrition therapy (MNT) referrals ---
  if (segments[0] === "mnt") {
    if (segments[1] === "patients" && segments.length === 3) {
      if (method !== "GET") return jsonError("Method not allowed", 405);
      return handleGetMntState(req, segments[2]!);
    }

    if (segments[1] === "referrals") {
      if (segments.length === 2) {
        if (method !== "POST") return jsonError("Method not allowed", 405);
        return handleCreateMntReferral(req);
      }
      if (segments.length === 4) {
        const action = MNT_REFERRAL_ACTIONS[segments[3] as keyof typeof MNT_REFERRAL_ACTIONS];
        if (!action) return jsonError("Not found", 404);
        if (method !== "POST") return jsonError("Method not allowed", 405);
        return action(req, segments[2]!);
      }
    }
    return jsonError("Not found", 404);
  }

  return jsonError("Not found", 404);
}
