import {
  buildClearedSmartSessionCookie,
  buildSmartSessionCookie,
  consumePendingSmartLaunch,
  createPendingSmartLaunch,
  createPkcePair,
  createSmartSession,
  deleteSmartSession,
  discoverSmartConfiguration,
  getSmartClientId,
  getSmartRedirectUri,
  getSmartScopes,
  getSmartSessionFromRequest,
  inferSmartVendor,
  normalizeSmartIssuer,
  type SmartTokenResponse,
} from "../lib/smart.js";
import { buildSessionCookie, createDemoSessionToken } from "../lib/auth.js";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const FORWARDED_FHIR_HEADERS = ["if-match", "if-none-match", "if-modified-since", "prefer"];
const RETURNED_FHIR_HEADERS = new Set(["content-type", "location", "content-location", "etag", "last-modified"]);

function htmlError(title: string, detail: string, status = 400): Response {
  const safeTitle = title.replace(/[<>&]/g, "");
  const safeDetail = detail.replace(/[<>&]/g, "");
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p>${safeDetail}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE_HEADERS } },
  );
}

export async function handleSmartLaunch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawIssuer = url.searchParams.get("iss");
  const launch = url.searchParams.get("launch");
  const requestedVendor = url.searchParams.get("vendor");

  if (!rawIssuer) return htmlError("SMART launch failed", "Missing required iss parameter.");
  if (!launch) return htmlError("SMART launch failed", "Missing required launch parameter.");

  try {
    const issuer = normalizeSmartIssuer(rawIssuer);
    const vendor = inferSmartVendor(issuer, requestedVendor);
    const clientId = getSmartClientId(issuer, vendor);
    const redirectUri = getSmartRedirectUri(request);
    const configuration = await discoverSmartConfiguration(issuer);
    const { verifier, challenge } = createPkcePair();

    const pending = createPendingSmartLaunch({
      issuer,
      launch,
      vendor,
      clientId,
      redirectUri,
      authorizationEndpoint: configuration.authorization_endpoint,
      tokenEndpoint: configuration.token_endpoint,
      codeVerifier: verifier,
    });

    const authorizationUrl = new URL(configuration.authorization_endpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", getSmartScopes());
    authorizationUrl.searchParams.set("aud", issuer);
    authorizationUrl.searchParams.set("launch", launch);
    authorizationUrl.searchParams.set("state", pending.state);
    authorizationUrl.searchParams.set("nonce", pending.nonce);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    return new Response(null, {
      status: 302,
      headers: {
        Location: authorizationUrl.toString(),
        ...NO_STORE_HEADERS,
      },
    });
  } catch (error) {
    console.error("SMART launch failed:", error instanceof Error ? error.message : "unknown error");
    return htmlError("SMART launch failed", error instanceof Error ? error.message : "Unable to start SMART authorization.", 500);
  }
}

export async function handleSmartCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");
  if (error) {
    return htmlError("SMART authorization was not completed", errorDescription || error, 400);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return htmlError("SMART callback failed", "Missing authorization code or state parameter.");

  const pending = consumePendingSmartLaunch(state);
  if (!pending) {
    return htmlError("SMART callback failed", "The SMART launch state is invalid or expired. Start a new EHR launch.", 400);
  }

  try {
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    });

    const tokenResponse = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: tokenBody,
    });

    const token = (await tokenResponse.json().catch(() => null)) as Partial<SmartTokenResponse> | null;
    if (!tokenResponse.ok || !token || typeof token.access_token !== "string" || !token.access_token) {
      const oauthError = token && typeof (token as { error?: unknown }).error === "string"
        ? String((token as { error: string }).error)
        : `token endpoint returned ${tokenResponse.status}`;
      throw new Error(`SMART token exchange failed: ${oauthError}`);
    }

    const session = createSmartSession(pending.issuer, token as SmartTokenResponse);
    const destination = session.patientId ? `/patients/${encodeURIComponent(session.patientId)}` : "/patients";

    // Compatibility bridge for the current UI shell: SMART provides the real
    // EHR/FHIR authorization, while the existing role gate still expects a
    // clinician session. Replace this bridge with fhirUser/PractitionerRole
    // authorization when the app's identity layer is refactored.
    const demoClinicianToken = createDemoSessionToken("clinician");

    const headers = new Headers({
      Location: destination,
      ...NO_STORE_HEADERS,
    });
    headers.append("Set-Cookie", buildSmartSessionCookie(session));
    headers.append("Set-Cookie", buildSessionCookie(demoClinicianToken));

    return new Response(null, { status: 302, headers });
  } catch (callbackError) {
    console.error("SMART callback failed:", callbackError instanceof Error ? callbackError.message : "unknown error");
    return htmlError("SMART callback failed", callbackError instanceof Error ? callbackError.message : "Unable to complete SMART authorization.", 502);
  }
}

export async function handleSmartSession(request: Request): Promise<Response> {
  const session = getSmartSessionFromRequest(request);
  if (!session) {
    return Response.json({ authenticated: false }, { status: 200, headers: NO_STORE_HEADERS });
  }

  return Response.json(
    {
      authenticated: true,
      issuer: session.issuer,
      patientId: session.patientId,
      encounterId: session.encounterId,
      fhirUser: session.fhirUser,
      scope: session.scope,
      expiresAt: session.expiresAt,
    },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

export async function handleSmartLogout(request: Request): Promise<Response> {
  const session = getSmartSessionFromRequest(request);
  deleteSmartSession(session?.id);
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": buildClearedSmartSessionCookie(), ...NO_STORE_HEADERS } },
  );
}

/**
 * If a SMART session is active, proxy /fhir requests to the EHR issuer using
 * the short-lived OAuth token. Returns null when this is a normal Medblocks
 * demo request so the existing FHIR proxy can handle it unchanged.
 */
export async function maybeProxySmartFhirRequest(request: Request): Promise<Response | null> {
  const session = getSmartSessionFromRequest(request);
  if (!session) return null;

  const incoming = new URL(request.url);
  const subPath = incoming.pathname.replace(/^\/fhir/, "") || "/";
  const upstream = new URL(`${session.issuer}${subPath}`);
  upstream.search = incoming.search;

  const headers = new Headers({
    Authorization: `${session.tokenType} ${session.accessToken}`,
    Accept: "application/fhir+json",
  });

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  if (hasBody) {
    headers.set("Content-Type", request.headers.get("content-type") || "application/fhir+json");
  }
  for (const name of FORWARDED_FHIR_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // @ts-expect-error Bun/undici requires duplex for streamed request bodies.
      duplex: hasBody ? "half" : undefined,
    });

    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    upstreamResponse.headers.forEach((value, key) => {
      if (RETURNED_FHIR_HEADERS.has(key.toLowerCase())) responseHeaders.set(key, value);
    });
    return new Response(upstreamResponse.body, { status: upstreamResponse.status, headers: responseHeaders });
  } catch (proxyError) {
    console.error("SMART FHIR proxy failed:", proxyError instanceof Error ? proxyError.message : "unknown error");
    return Response.json(
      {
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "exception", diagnostics: "Waypoint could not reach the SMART FHIR server." }],
      },
      { status: 502, headers: { "Content-Type": "application/fhir+json", "Cache-Control": "no-store" } },
    );
  }
}

export async function handleSmartRequest(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  if (pathname === "/smart/launch") {
    if (method !== "GET") return new Response("Method not allowed", { status: 405 });
    return handleSmartLaunch(request);
  }
  if (pathname === "/smart/callback") {
    if (method !== "GET") return new Response("Method not allowed", { status: 405 });
    return handleSmartCallback(request);
  }
  if (pathname === "/smart/session") {
    if (method !== "GET") return new Response("Method not allowed", { status: 405 });
    return handleSmartSession(request);
  }
  if (pathname === "/smart/logout") {
    if (method !== "POST") return new Response("Method not allowed", { status: 405 });
    return handleSmartLogout(request);
  }

  return new Response("Not found", { status: 404 });
}
