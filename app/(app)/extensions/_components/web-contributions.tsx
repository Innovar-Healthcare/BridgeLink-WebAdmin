"use client";

/**
 * "Web Contributions" status card on the Extensions page.
 *
 * One row per extension that shipped a webadmin manifest this session:
 * loaded (with its declared contribution count), or skipped with the single
 * human-readable reason recorded by the runtime plugin loader (invalid
 * manifest, version gate, defaults fetch failure, ...). Renders nothing when
 * no manifests were served — a plain install without the endpoint (older
 * Core) stays noise-free; in development builds only, that unavailable state
 * shows a one-line diagnostic so a misconfigured fixture directory is obvious.
 */

import { useRuntimePluginStatuses } from "@/lib/runtime-plugins/status-store";

export function WebContributions() {
  const { statuses, listState } = useRuntimePluginStatuses();

  const showUnavailableNote =
    statuses.length === 0 && listState === "unavailable" && process.env.NODE_ENV === "development";
  if (statuses.length === 0 && !showUnavailableNote) return null;

  return (
    <section className="shrink-0 border border-border rounded-lg p-4 bg-white dark:bg-gray-900">
      <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
        Web Contributions
      </h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
        UI contributed by installed extensions through their webadmin manifest.
      </p>
      {showUnavailableNote ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          The webadmin manifest list is unavailable on this server (older Core, or the fixture
          directory is not being served).
        </p>
      ) : (
        <div className="space-y-1.5">
          {/* Keyed by index: rows are append-only per load run, and name/version
              are server-controlled strings that can collide (e.g. two malformed
              entries both surfacing as "(unknown extension)"). */}
          {statuses.map((status, i) => (
            <div key={i} className="flex items-baseline gap-2 text-sm">
              <span
                aria-hidden
                className={`self-center size-2 rounded-full shrink-0 ${
                  status.status === "loaded"
                    ? "bg-green-500"
                    : status.status === "partial"
                      ? "bg-amber-500"
                      : "bg-yellow-500"
                }`}
              />
              <span className="font-medium text-gray-700 dark:text-gray-300">{status.name}</span>
              {status.version && (
                <span className="text-xs text-gray-400 dark:text-gray-500">{status.version}</span>
              )}
              {status.status === "loaded" ? (
                <span className="text-xs text-green-700 dark:text-green-400">
                  Loaded ({status.contributionCount}{" "}
                  {status.contributionCount === 1 ? "contribution" : "contributions"})
                </span>
              ) : status.status === "partial" ? (
                <span className="text-xs text-amber-700 dark:text-amber-500 min-w-0">
                  Loaded with conflicts ({status.contributionCount} of{" "}
                  {status.contributionCount + (status.droppedContributions?.length ?? 0)}{" "}
                  contributions) —{" "}
                  {(status.droppedContributions ?? [])
                    .map((d) => `${d.kind} "${d.key}": ${d.reason}`)
                    .join("; ")}
                </span>
              ) : (
                <span className="text-xs text-yellow-700 dark:text-yellow-500 min-w-0">
                  Skipped — {status.reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
