"use client";

import "@/plugins";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, loginWithMfaData, logout, getServerVersion } from "@/lib/api/api-auth";
import { saveSession, clearSession, getSession, updateSession } from "@/lib/auth";
import { evaluateServerCompatibility } from "@/lib/version-compat";
import { clearDataCaches } from "@/lib/logout";
import { generateTotpSecret, buildOtpAuthUri, verifyTotp } from "@/lib/mfa-utils";
import { Eye, EyeOff } from "lucide-react";
import { pluginRegistry } from "@/lib/plugin-registry";
import type { User } from "@/lib/types";
import { getUsers } from "@/lib/api/api-users";
import {
  getUserPreference,
  getPublicServerSettings,
  acknowledgeUserNotification,
  regenerateKeystore,
} from "@/lib/api/api-settings";
import { toast } from "sonner";
import { FormCheckbox } from "@/components/ui/form-checkbox";
import { InfoDialog } from "@/components/info-dialog";
import type { ServerConfig } from "@/lib/server-allowlist";
import { ChangePasswordScreen } from "./_components/change-password-screen";
import { FirstLoginScreen } from "./_components/first-login-screen";
import { LoginNotificationScreen } from "./_components/login-notification-screen";
import { KeystoreWarningScreen } from "./_components/keystore-warning-screen";
import { BETA_AGREEMENT_TEXT, BETA_AGREEMENT_VERSION } from "./_data/beta-agreement";

const LAST_SERVER_KEY = "bl_last_server";
const LAST_SERVER_TAB_KEY = "bl_last_server_tab";

/** Derive a sensible default BridgeLink server URL from the current page's hostname. */
function deriveDefaultServerUrl(): string {
  if (typeof window === "undefined") return "";
  const { hostname } = window.location;
  return hostname ? `https://${hostname}:8443` : "";
}

/**
 * Read the last-used server from storage (per-tab sessionStorage wins over the
 * cross-tab localStorage hint, then a hostname-derived default). Returns "" on
 * the server. Safe to use as a useState initializer because this route is
 * statically pre-rendered with the form deferred to the client (see Suspense
 * note below), so the initializer only runs client-side.
 */
function readStoredServer(): string {
  if (typeof window === "undefined") return "";
  const fromTab = sessionStorage.getItem(LAST_SERVER_TAB_KEY);
  const fromGlobal = localStorage.getItem(LAST_SERVER_KEY);
  return fromTab || fromGlobal || deriveDefaultServerUrl();
}

/**
 * Choose the initial value for the Server field based on the deployment mode
 * (from GET /api/config) and the last-used server remembered in storage.
 * Locked modes ignore the stored value; multi falls back to the default when
 * the remembered server is no longer in the allowlist.
 */
function pickInitialServer(cfg: ServerConfig, stored: string): string {
  switch (cfg.mode) {
    case "single":
    case "sameHost":
      return cfg.defaultServer;
    case "multi":
      return stored && cfg.servers.includes(stored) ? stored : cfg.defaultServer;
    case "open":
    default:
      return stored || cfg.defaultServer || deriveDefaultServerUrl();
  }
}

// ── Screen types ─────────────────────────────────────────────────────────────

type Screen =
  | "beta-warning"
  | "credentials"
  | "mfa-setup"
  | "mfa-otp"
  | "login-notification"
  | "change-password"
  | "first-login"
  | "keystore-warning";

/** Login result shape carried through the post-login flow. */
type LoginResult = { status: string; message: string };

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverUrl, setServerUrl] = useState<string>(readStoredServer);
  const [serverConfig, setServerConfig] = useState<ServerConfig | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);

  // MFA flow state
  const [screen, setScreen] = useState<Screen>(
    process.env.NEXT_PUBLIC_BETA_MODE === "true" ? "beta-warning" : "credentials"
  );
  const [betaDeclined, setBetaDeclined] = useState(false);
  const [betaAgreed, setBetaAgreed] = useState(false);
  const [showBetaAgreement, setShowBetaAgreement] = useState(false);
  const [mfaUsername, setMfaUsername] = useState("");
  // Setup screen
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState("");
  const [mfaSetupCode, setMfaSetupCode] = useState("");
  // OTP screen
  const [otpCode, setOtpCode] = useState("");

  // Post-login screen state (change-password / first-login)
  const [postLoginUser, setPostLoginUser] = useState<User | null>(null);
  const [gracePeriodMsg, setGracePeriodMsg] = useState("");

  // Login Notification & Consent state. When the server setting is enabled we
  // show the consent screen and defer the rest of the post-login routing until
  // the user accepts (mirrors Java LoginPanel.handleSuccess).
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [pendingPostLogin, setPendingPostLogin] = useState<{
    result: LoginResult;
    user: User;
  } | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Default-keystore-password warning state. The flag is captured
  // from GET /server/publicSettings during post-login; when true, the
  // keystore-warning screen is shown as the last step before entering the app.
  // A ref, not state: completeLogin can run in the SAME async chain as the
  // capture (direct path — no intervening notification/first-login screen), so
  // a state setter would not be visible to its already-bound closure and the
  // warning would never show. The flag drives control flow only (never
  // rendered), so a ref is the correct mechanism.
  // `keystoreWorking` gates the screen's buttons while the regenerate POST runs.
  const keystoreDefaultPwRef = useRef(false);
  const [keystoreWorking, setKeystoreWorking] = useState(false);

  // Resolve the deployment mode (GET /api/config) and seed the Server field.
  // Per-tab sessionStorage wins over the cross-tab localStorage hint so logging
  // out of Server A doesn't show Server B's URL when Tab B is also logged in
  //. The allowlist mode then decides whether that value is honored,
  // overridden (locked modes), or used as-is (open/multi).
  useEffect(() => {
    // serverUrl is already seeded synchronously from storage by the useState
    // initializer above; here we only resolve the deployment mode and, for
    // locked/allowlisted modes, pin the field to an allowed value.
    const fromTab = sessionStorage.getItem(LAST_SERVER_TAB_KEY);
    const fromGlobal = localStorage.getItem(LAST_SERVER_KEY);
    const stored = fromTab || fromGlobal || "";

    let cancelled = false;
    (async () => {
      let cfg: ServerConfig;
      try {
        const res = await fetch("/api/config");
        cfg = (await res.json()) as ServerConfig;
      } catch {
        // Endpoint unreachable — fall back to free-text with a derived default.
        cfg = { mode: "open", servers: [], defaultServer: deriveDefaultServerUrl() };
      }
      if (cancelled) return;
      setServerConfig(cfg);
      // Locked/allowlisted modes pin the field to an allowed value; open mode
      // keeps whatever was already seeded (and never clobbers user input).
      if (cfg.mode !== "open") {
        setServerUrl(pickInitialServer(cfg, stored));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Navigate to dashboard after all post-login checks pass ────────────────

  async function completeLogin() {
    // Version-compatibility gate: refuse to enter the app when the
    // Core server is older than this Web Admin build supports. GET /server/version
    // needs no auth; on any fetch failure we fall through (evaluate treats an
    // unknown version as compatible — fail-open, never lock out on a hiccup).
    const serverVersion = await getServerVersion(getSession()?.serverUrl ?? "").catch(() => "");
    const compat = evaluateServerCompatibility(serverVersion);
    if (compat.level === "block") {
      clearSession();
      setError(compat.message);
      setScreen("credentials");
      return;
    }
    // Persist the resolved version so the app-shell effect skips the re-fetch.
    if (serverVersion) updateSession({ serverVersion });

    if (pluginRegistry.postLoginVerify) {
      try {
        const session = getSession();
        await pluginRegistry.postLoginVerify(session?.serverUrl ?? "", session?.username ?? "");
      } catch (err) {
        clearSession();
        setError(err instanceof Error ? err.message : "Login blocked by server policy.");
        setScreen("credentials");
        return;
      }
    }

    // Default-keystore-password warning — the last post-login gate,
    // matching Java LoginPanel.handleSuccess ordering (after login-notification,
    // first-login, and grace-period password change). Defer entry until the user
    // dismisses the warning; finishLogin() performs the actual navigation.
    if (keystoreDefaultPwRef.current) {
      setScreen("keystore-warning");
      return;
    }

    finishLogin();
  }

  /** Clear caches and navigate into the app. The single dashboard-entry exit. */
  function finishLogin() {
    clearDataCaches();
    const returnUrl = searchParams.get("returnUrl");
    const destination =
      returnUrl && returnUrl.startsWith("/") && !returnUrl.startsWith("//")
        ? returnUrl
        : "/dashboard";
    router.replace(destination);
  }

  // ── Keystore warning — OK optionally regenerates, then enters the app ──────

  async function handleKeystoreOk(regenerate: boolean) {
    if (regenerate) {
      setKeystoreWorking(true);
      try {
        const res = await regenerateKeystore();
        toast.success(res.message);
      } catch (err) {
        // Mirrors Java's error dialog; a 403 (no SERVER_SETTINGS_EDIT) surfaces
        // here rather than hard-blocking login.
        toast.error(
          err instanceof Error ? err.message : "Failed to regenerate keystore passwords."
        );
      } finally {
        setKeystoreWorking(false);
      }
    }
    finishLogin();
  }

  // ── Post-login: save session, resolve user, then login-notification gate ──

  async function handlePostLogin(result: LoginResult, trimmedUrl: string, trimmedUser: string) {
    // Save session early so API calls can route through the proxy.
    // Per-tab sessionStorage anchors this tab's "last server" so a sibling tab
    // logging into a different server can't overwrite it.
    sessionStorage.setItem(LAST_SERVER_TAB_KEY, trimmedUrl);
    localStorage.setItem(LAST_SERVER_KEY, trimmedUrl);
    saveSession({ username: trimmedUser, serverUrl: trimmedUrl });

    // Fetch users to get the current user's ID and User object.
    let currentUser: User | null = null;
    try {
      const users = await getUsers();
      currentUser = users.find((u) => u.username === trimmedUser) ?? null;
      if (currentUser !== null) {
        updateSession({ userId: currentUser.id });
      }
    } catch {
      // API failure — fall through to normal login rather than blocking.
    }

    // Login Notification & Consent gate (mirrors Java LoginPanel.handleSuccess):
    // when the server requires it, show the consent screen and defer the rest of
    // the post-login routing until the user accepts. Uses GET /server/publicSettings
    // (readable by any authenticated user) rather than the permission-gated
    // GET /server/settings. Gated on the enabled flag only — shown every login.
    // Reset the keystore flag per login attempt so a failed publicSettings
    // fetch below can't leak a previous login's value (e.g. after logging out
    // of a default-password server and into a different one from this mount).
    keystoreDefaultPwRef.current = false;
    try {
      const pub = await getPublicServerSettings();
      // Capture the keystore default-password flag now (same call the Java client
      // uses); completeLogin surfaces the warning as the last post-login step.
      keystoreDefaultPwRef.current = pub.keystoreUsingDefaultPassword === true;
      if (pub.loginNotificationEnabled === true && currentUser !== null) {
        setPendingPostLogin({ result, user: currentUser });
        setLoginNotice(pub.loginNotificationMessage ?? "");
        setScreen("login-notification");
        return;
      }
    } catch {
      // Fail-open: a public-settings failure must never block login (mirrors Java's catch).
    }

    await routeAfterLogin(result, currentUser);
  }

  // ── Route to the correct post-login screen (first-login / grace / dashboard) ──

  async function routeAfterLogin(result: LoginResult, currentUser: User | null) {
    // Check "firstlogin" preference. Empty string = preference never set = first login.
    let isFirstLogin = false;
    if (currentUser !== null) {
      try {
        const pref = await getUserPreference(currentUser.id, "firstlogin");
        isFirstLogin = pref === "" || pref === "true";
      } catch {
        // Fall through on preference fetch failure.
      }
    }

    // Route: first-login takes priority over grace-period (mirrors Java ordering).
    if (isFirstLogin && currentUser !== null) {
      setPostLoginUser(currentUser);
      setGracePeriodMsg(result.status === "SUCCESS_GRACE_PERIOD" ? result.message : "");
      setScreen("first-login");
    } else if (result.status === "SUCCESS_GRACE_PERIOD" && currentUser !== null) {
      setPostLoginUser(currentUser);
      setGracePeriodMsg(result.message);
      setScreen("change-password");
    } else {
      await completeLogin();
    }
  }

  // ── Login Notification consent — Accept records acknowledgment, then routes ──

  async function handleAcceptNotification() {
    if (pendingPostLogin === null) return;
    const { result, user } = pendingPostLogin;
    setAccepting(true);
    try {
      // Best-effort acknowledgment — a failure here must not block login (mirrors Java).
      await acknowledgeUserNotification(user.id).catch(() => {});
      await routeAfterLogin(result, user);
    } finally {
      setAccepting(false);
    }
  }

  // ── Log out from a post-login screen ─────────────────────────────────────

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Ignore — we're logging out regardless.
    }
    clearSession();
    setPostLoginUser(null);
    setGracePeriodMsg("");
    setPendingPostLogin(null);
    setLoginNotice(null);
    setAccepting(false);
    setScreen("credentials");
    setError("");
  }

  // ── Credentials form ───────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const trimmedUrl = serverUrl.trim();
      const trimmedUser = username.trim();
      const result = await login(trimmedUrl, trimmedUser, password);

      if (result.status === "SUCCESS" || result.status === "SUCCESS_GRACE_PERIOD") {
        await handlePostLogin(result, trimmedUrl, trimmedUser);
      } else if (result.mfa) {
        // Server requires MFA — switch to the appropriate MFA screen.
        setMfaUsername(result.mfa.username);
        if (result.mfa.hasSecret) {
          setScreen("mfa-otp");
        } else {
          // First-time setup: generate secret + QR code.
          const secret = generateTotpSecret();
          setMfaSecret(secret);
          const uri = buildOtpAuthUri(result.mfa.username, secret);
          try {
            // Lazy import: qrcode pulls pngjs (Node events) + yargs, which drag in
            // Node-core polyfills whose module-init Function() calls trip the CSP.
            // Loading it only when the TOTP QR is rendered keeps it off page load.
            const { default: QRCode } = await import("qrcode");
            const dataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });
            setMfaQrDataUrl(dataUrl);
          } catch {
            setMfaQrDataUrl("");
          }
          setMfaSetupCode("");
          setScreen("mfa-setup");
        }
      } else {
        setError(result.message || `Login failed: ${result.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  // ── MFA Setup (first-time) ─────────────────────────────────────────────────

  async function handleMfaSetup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    // Client-side TOTP verification before sending to server.
    // Ensures the user actually scanned the QR code correctly.
    const trimmedCode = mfaSetupCode.trim();
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      setError("Please enter the 6-digit code from your authenticator app.");
      return;
    }
    const valid = await verifyTotp(mfaSecret, trimmedCode);
    if (!valid) {
      setError("The code is incorrect. Make sure your app is synced and try again.");
      return;
    }

    setLoading(true);
    try {
      const result = await loginWithMfaData(serverUrl.trim(), mfaUsername, "setup", mfaSecret);
      if (result.status === "SUCCESS" || result.status === "SUCCESS_GRACE_PERIOD") {
        await handlePostLogin(result, serverUrl.trim(), mfaUsername);
      } else {
        setError(result.message || "MFA setup failed. Please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "MFA setup failed");
    } finally {
      setLoading(false);
    }
  }

  // ── MFA OTP verification ───────────────────────────────────────────────────

  async function handleMfaOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const trimmedCode = otpCode.trim();
    if (trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
      setError("Please enter your 6-digit authenticator code.");
      return;
    }
    setLoading(true);
    try {
      const result = await loginWithMfaData(serverUrl.trim(), mfaUsername, "otp", trimmedCode);
      if (result.status === "SUCCESS" || result.status === "SUCCESS_GRACE_PERIOD") {
        await handlePostLogin(result, serverUrl.trim(), mfaUsername);
      } else {
        setError(result.message || "Invalid code. Please try again.");
        setOtpCode("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  const SsoSection = pluginRegistry.ssoLoginSection;
  const anySsoLoading = loading || ssoLoading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-950">
      {/* Logo */}
      <div className="mb-8">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/bridgelink-logo.png" alt="BridgeLink" className="h-16 w-auto" />
      </div>

      <div
        className={`w-full ${screen === "first-login" ? "max-w-4xl" : "max-w-md"} bg-white dark:bg-gray-800 shadow-lg rounded-lg border border-border`}
      >
        {/* ── Beta warning screen ── */}
        {screen === "beta-warning" && (
          <div className="p-8 space-y-5">
            {betaDeclined ? (
              <>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Access Declined
                  </h2>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    You have declined the Beta Software Agreement. You must accept the agreement to
                    access BridgeLink WebAdmin. Please close this browser window or contact your
                    administrator.
                  </p>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBetaDeclined(false);
                      setBetaAgreed(false);
                    }}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    ← Back
                  </button>
                </div>
              </>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Pre-Release Beta Software
                  </h2>
                  <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                    You are accessing a pre-release beta version of BridgeLink WebAdmin. By
                    continuing, you acknowledge and agree to the following:
                  </p>
                </div>

                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400 list-disc list-outside pl-4">
                  <li>
                    This software is provided for evaluation purposes only under the terms of your
                    signed Beta Software Agreement with Innovar Healthcare.
                  </li>
                  <li>
                    This is beta software. You may encounter bugs, incomplete features, or
                    unexpected behavior.
                  </li>
                  <li>
                    Do not use this software in a production environment or with live patient data,
                    clinical workflows, or operational healthcare systems.
                  </li>
                  <li>Some features may not function correctly or may change without notice.</li>
                </ul>

                <div className="border-t border-border pt-4 space-y-3">
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    By checking the box below and clicking <strong>Continue</strong>, you confirm
                    that you have read, signed, and agree to be bound by the BridgeLink WebAdmin
                    Beta Software Agreement.
                  </p>

                  <button
                    type="button"
                    onClick={() => setShowBetaAgreement(true)}
                    className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View full Beta Software Agreement (Version {BETA_AGREEMENT_VERSION})
                  </button>

                  <FormCheckbox
                    checked={betaAgreed}
                    onChange={setBetaAgreed}
                    size="sm"
                    label={`I have read and agree to be bound by the BridgeLink WebAdmin Beta Software Agreement (Version ${BETA_AGREEMENT_VERSION}).`}
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setBetaDeclined(true)}
                    className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    Sign Out
                  </button>
                  <Button
                    type="button"
                    onClick={() => setScreen("credentials")}
                    disabled={!betaAgreed}
                    className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Credentials screen ── */}
        {screen === "credentials" && (
          <form onSubmit={handleLogin} className="p-8 space-y-5">
            <div className="space-y-1">
              <Label
                htmlFor="server"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Server
              </Label>
              {serverConfig?.mode === "multi" ? (
                // Allowlist configured — restrict the field to permitted servers.
                <select
                  id="server"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 font-mono text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  required
                >
                  {serverConfig.servers.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : serverConfig &&
                (serverConfig.mode === "single" || serverConfig.mode === "sameHost") ? (
                // Locked to a single operator-configured server.
                <Input
                  id="server"
                  type="text"
                  value={serverUrl}
                  readOnly
                  aria-readonly="true"
                  className="font-mono text-sm bg-muted text-muted-foreground cursor-not-allowed"
                />
              ) : (
                // Open mode (dev / BL_ALLOW_ANY_SERVER) or config still loading — free text.
                <Input
                  id="server"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://hostname:8443"
                  className="font-mono text-sm"
                  required
                  onInvalid={(e) =>
                    (e.target as HTMLInputElement).setCustomValidity("Value required")
                  }
                  onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")}
                />
              )}
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="username"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Username
              </Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                required
                onInvalid={(e) =>
                  (e.target as HTMLInputElement).setCustomValidity("Value required")
                }
                onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")}
              />
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="password"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                  required
                  onInvalid={(e) =>
                    (e.target as HTMLInputElement).setCustomValidity("Value required")
                  }
                  onInput={(e) => (e.target as HTMLInputElement).setCustomValidity("")}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end pt-2">
              <Button
                type="submit"
                disabled={anySsoLoading}
                data-testid="login-submit"
                className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5"
              >
                {loading ? "Logging in…" : "Login"}
              </Button>
            </div>

            {/* SSO slot — rendered by the installed SSO plugin (e.g. OIDC), or null */}
            {SsoSection && (
              <SsoSection
                serverUrl={serverUrl}
                disabled={anySsoLoading}
                onError={setError}
                onLoadingChange={setSsoLoading}
              />
            )}
          </form>
        )}

        {/* ── MFA Setup screen (first-time) ── */}
        {screen === "mfa-setup" && (
          <form onSubmit={handleMfaSetup} className="p-8 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Set Up Two-Factor Authentication
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.),
                then enter the 6-digit code to confirm.
              </p>
            </div>

            {/* QR code */}
            <div className="flex flex-col items-center gap-3">
              {mfaQrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={mfaQrDataUrl}
                  alt="Scan this QR code with your authenticator app"
                  className="rounded border border-border"
                  width={200}
                  height={200}
                />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center rounded border border-border bg-gray-50 dark:bg-gray-700 text-xs text-gray-400">
                  QR unavailable
                </div>
              )}
              {/* Manual entry secret */}
              <div className="text-center">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                  Or enter this key manually:
                </p>
                <code className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded select-all break-all">
                  {mfaSecret}
                </code>
              </div>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="setup-code"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Verification Code
              </Label>
              <Input
                id="setup-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={mfaSetupCode}
                onChange={(e) => setMfaSetupCode(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
                className="text-center tracking-widest text-lg font-mono"
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setScreen("credentials");
                  setError("");
                }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ← Back
              </button>
              <Button
                type="submit"
                disabled={loading || mfaSetupCode.length !== 6}
                className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5"
              >
                {loading ? "Verifying…" : "Verify & Continue"}
              </Button>
            </div>
          </form>
        )}

        {/* ── MFA OTP screen (subsequent logins) ── */}
        {screen === "mfa-otp" && (
          <form onSubmit={handleMfaOtp} className="p-8 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Two-Factor Authentication
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Enter the 6-digit code from your authenticator app.
              </p>
            </div>

            <div className="space-y-1">
              <Label
                htmlFor="otp-code"
                className="text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Authentication Code
              </Label>
              <Input
                id="otp-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={otpCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "");
                  setOtpCode(val);
                }}
                autoComplete="one-time-code"
                className="text-center tracking-widest text-lg font-mono"
                autoFocus
              />
            </div>

            {error && (
              <div className="rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setScreen("credentials");
                  setError("");
                  setOtpCode("");
                }}
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ← Back
              </button>
              <Button
                type="submit"
                disabled={loading || otpCode.length !== 6}
                className="bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 border border-border px-5"
              >
                {loading ? "Verifying…" : "Verify"}
              </Button>
            </div>
          </form>
        )}

        {/* ── Login Notification & Consent screen (loginNotificationEnabled) ── */}
        {screen === "login-notification" && loginNotice !== null && (
          <LoginNotificationScreen
            message={loginNotice}
            accepting={accepting}
            onAccept={handleAcceptNotification}
            onCancel={handleLogout}
          />
        )}

        {/* ── Change Password screen (SUCCESS_GRACE_PERIOD) ── */}
        {screen === "change-password" && postLoginUser !== null && (
          <ChangePasswordScreen
            user={postLoginUser}
            gracePeriodMsg={gracePeriodMsg}
            onSuccess={completeLogin}
            onLogout={handleLogout}
          />
        )}

        {/* ── First Login screen (firstlogin preference = true / unset) ── */}
        {screen === "first-login" && postLoginUser !== null && (
          <FirstLoginScreen
            user={postLoginUser}
            gracePeriodMsg={gracePeriodMsg}
            onSuccess={completeLogin}
            onLogout={handleLogout}
          />
        )}

        {/* ── Keystore default-password warning (keystoreUsingDefaultPassword) ── */}
        {screen === "keystore-warning" && (
          <KeystoreWarningScreen
            working={keystoreWorking}
            onOk={handleKeystoreOk}
            onRemindLater={finishLogin}
          />
        )}
      </div>

      <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
        BridgeLink Web Administrator v{process.env.NEXT_PUBLIC_APP_VERSION} (
        {process.env.NEXT_PUBLIC_GIT_SHA})
      </p>

      <InfoDialog
        open={showBetaAgreement}
        onOpenChange={setShowBetaAgreement}
        title="BridgeLink WebAdmin Beta Software Agreement"
        description={`Version ${BETA_AGREEMENT_VERSION}`}
        maxWidth="sm:max-w-3xl"
      >
        <div className="max-h-[60vh] overflow-auto rounded border border-border bg-muted/30 p-4">
          <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed">
            {BETA_AGREEMENT_TEXT}
          </pre>
        </div>
      </InfoDialog>
    </div>
  );
}

// Wrap in Suspense so useSearchParams() doesn't cause a CSR bailout during
// static pre-rendering (Next.js App Router requirement).
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageInner />
    </Suspense>
  );
}
