import { useState, useEffect, useCallback } from "react";
import { loadAdminPrefs } from "@/lib/admin-prefs";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const LS_LAST_CHECK = "bl-update-check-ts";
const LS_CACHED_RESULT = "bl-update-check-result";
const LS_DISMISSED = "bl-update-dismissed";
const LS_BANNER_DISMISSED = "bl-update-banner-dismissed";

export interface UpdateCheckResult {
  updateAvailable: boolean;
  latestVersion: string;
  releaseNotesUrl: string;
  downloadUrl: string;
}

function readLS<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded or storage unavailable — non-fatal
  }
}

function removeLS(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // non-fatal
  }
}

export function useUpdateCheck() {
  const [result, setResult] = useState<UpdateCheckResult | null>(() => {
    const cached = readLS<UpdateCheckResult>(LS_CACHED_RESULT);
    return cached?.updateAvailable ? cached : null;
  });
  // Lazy initializers read localStorage once at mount; readLS guards against SSR
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => readLS<{ version: string }>(LS_DISMISSED)?.version ?? null
  );
  const [bannerDismissedVersion, setBannerDismissedVersion] = useState<string | null>(
    () => readLS<{ version: string }>(LS_BANNER_DISMISSED)?.version ?? null
  );

  useEffect(() => {
    if (!loadAdminPrefs().checkForUpdates) return;

    // Throttle: skip the network call if we checked within the last 24 hours
    const lastCheck = readLS<number>(LS_LAST_CHECK) ?? 0;
    if (Date.now() - lastCheck < CHECK_INTERVAL_MS) return;

    // Use AbortController so cleanup (including React Strict Mode's artificial
    // cleanup+remount) actually cancels the in-flight request. The throttle
    // timestamp is written AFTER the fetch completes — writing it before would
    // cause the Strict Mode remount to see a recent timestamp and skip the
    // check, leaving the first aborted fetch as the only attempt.
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/version-check", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as UpdateCheckResult | null;
        writeLS(LS_LAST_CHECK, Date.now());
        if (data?.updateAvailable) {
          writeLS(LS_CACHED_RESULT, data);
          setResult(data);
        } else {
          removeLS(LS_CACHED_RESULT);
          setResult(null);
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") return;
        // Fail silent — a check failure must never disrupt the app
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const latestVersion = result?.latestVersion ?? null;

  const isDismissed = latestVersion !== null && latestVersion === dismissedVersion;

  const isBannerDismissed =
    latestVersion !== null && (latestVersion === bannerDismissedVersion || isDismissed);

  // "Got it" — clears both the nav badge and the banner for this version
  const dismiss = useCallback(() => {
    if (!latestVersion) return;
    writeLS(LS_DISMISSED, { version: latestVersion });
    writeLS(LS_BANNER_DISMISSED, { version: latestVersion });
    setDismissedVersion(latestVersion);
    setBannerDismissedVersion(latestVersion);
  }, [latestVersion]);

  // "✕" on the banner — hides banner only; nav badge stays
  const dismissBanner = useCallback(() => {
    if (!latestVersion) return;
    writeLS(LS_BANNER_DISMISSED, { version: latestVersion });
    setBannerDismissedVersion(latestVersion);
  }, [latestVersion]);

  return { result, isDismissed, isBannerDismissed, dismiss, dismissBanner };
}
