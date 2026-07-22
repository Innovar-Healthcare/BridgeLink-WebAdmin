/**
 * API auth — server info, login, logout.
 */

import { PROXY_BASE, request, extractApiErrorMessage } from "./api-core";

/**
 * GET /server/version — returns the server version as plain text (e.g. "4.6.1").
 * Mirrors Java client: Frame.java calls mirthClient.getVersion() immediately after
 * login and stores the result in PlatformUI.SERVER_VERSION, which is then used as
 * the version attribute on all exported XML objects via ObjectXMLSerializer.
 *
 * Must pass the serverUrl explicitly because this is called before the session is
 * written to sessionStorage (getServerUrl() would return "").
 */
export async function getServerVersion(serverUrl: string): Promise<string> {
  const res = await fetch(`${PROXY_BASE}/server/version`, {
    headers: {
      Accept: "text/plain",
      "x-bl-server": serverUrl,
    },
    credentials: "include",
  });
  if (!res.ok) throw new Error(extractApiErrorMessage(await res.text().catch(() => "")));
  return (await res.text()).trim();
}

/** Parsed result from a login call. */
export interface LoginResult {
  status: string;
  message: string;
  /**
   * The BridgeLink username the server resolved after login. Set when the server
   * returns a non-empty updatedUsername in LoginStatus (e.g. after OIDC provisioning
   * where the final username may differ from the one sent in the request).
   */
  username?: string;
  /** Set when the server requires MFA before granting access. */
  mfa?: {
    username: string;
    hasSecret: boolean;
  };
}

/**
 * Parse the XStream-wrapped login response body.
 * Handles both LoginStatus and ExtendedLoginStatus (MFA challenge).
 */
function parseLoginResponse(text: string): LoginResult {
  const json = JSON.parse(text) as Record<string, unknown>;

  // ExtendedLoginStatus — MFA challenge from the RBAC plugin
  const extended = json["com.mirth.connect.model.ExtendedLoginStatus"] as
    | Record<string, unknown>
    | undefined;
  if (extended) {
    const status = String(extended.status ?? "FAIL");
    const rawMessage = String(extended.message ?? "{}");
    try {
      const msg = JSON.parse(rawMessage) as { username?: string; hasSecret?: boolean };
      if (msg.username !== undefined) {
        return {
          status,
          message: rawMessage,
          mfa: { username: msg.username, hasSecret: Boolean(msg.hasSecret) },
        };
      }
    } catch {
      // Fall through to generic error
    }
    return { status, message: rawMessage };
  }

  // Normal LoginStatus
  const inner = (json["com.mirth.connect.model.LoginStatus"] ?? json) as Record<string, unknown>;
  const updatedUsername = inner.updatedUsername;
  return {
    status: String(inner.status ?? ""),
    message: String(inner.message ?? ""),
    username: updatedUsername != null ? String(updatedUsername) : undefined,
  };
}

export async function login(
  serverUrl: string,
  username: string,
  password: string
): Promise<LoginResult> {
  const res = await fetch(`${PROXY_BASE}/users/_login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-bl-server": serverUrl,
    },
    credentials: "include",
    body: new URLSearchParams({ username, password }).toString(),
  });

  const text = await res.text().catch(() => "(no response body)");

  // Detect HTML responses — the server URL likely points to a web page, not the API.
  const textStart = text.trimStart();
  if (textStart.startsWith("<!") || textStart.toLowerCase().startsWith("<html")) {
    throw new Error(
      "The server URL appears to be incorrect — it returned an HTML page instead of " +
        "a JSON API response. Make sure you're entering the BridgeLink server address " +
        "(e.g., https://hostname:8443), not the web application URL."
    );
  }

  if (!res.ok) {
    // Proxy returns 502 when the upstream server is unreachable
    if (res.status === 502) {
      throw new Error(
        "Could not reach the BridgeLink server. Verify the server address is correct and the server is running."
      );
    }
    // Try to parse as MFA challenge or error
    try {
      return parseLoginResponse(text);
    } catch {
      // ignore parse error — fall through
    }
    throw new Error(extractApiErrorMessage(text) || `Login failed (${res.status})`);
  }

  if (!text) return { status: "SUCCESS", message: "" };
  try {
    return parseLoginResponse(text);
  } catch {
    if (text.includes("SUCCESS")) return { status: "SUCCESS", message: "" };
    throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  }
}

/**
 * Second leg of the MFA login flow.
 * Sends the MFA response (setup secret or OTP code) via the X-Mirth-Login-Data header.
 * Mirrors Java's MfaChallengeClient.authenticate() second login call.
 */
export async function loginWithMfaData(
  serverUrl: string,
  username: string,
  action: "setup" | "otp",
  response: string
): Promise<LoginResult> {
  const loginData = JSON.stringify({ username, action, response });
  const res = await fetch(`${PROXY_BASE}/users/_login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-bl-server": serverUrl,
      "x-mirth-login-data": loginData,
    },
    credentials: "include",
    // Password is not re-checked on the second call; username is still required.
    body: new URLSearchParams({ username, password: "" }).toString(),
  });

  const text = await res.text().catch(() => "(no response body)");
  if (!res.ok) {
    try {
      return parseLoginResponse(text);
    } catch {
      // ignore
    }
    throw new Error(extractApiErrorMessage(text) || `MFA verification failed (${res.status})`);
  }
  if (!text) return { status: "SUCCESS", message: "" };
  try {
    return parseLoginResponse(text);
  } catch {
    if (text.includes("SUCCESS")) return { status: "SUCCESS", message: "" };
    throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
  }
}

export async function logout() {
  return request<void>("/users/_logout", { method: "POST" });
}
