import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type { UrlFilterParams } from "./message-helpers";

/**
 * Deep-link query params that can carry PHI. `metaDataValue` may hold a patient
 * identifier (the app special-cases a PATIENT_ID metadata column); the column
 * name and operator are the rest of that same search row and are meaningless
 * without the value, so all three are scrubbed from the URL together after they
 * are consumed into filter state. Message-ID params and channelId are
 * internal, non-PHI identifiers and are intentionally left in the URL so those
 * deep links stay shareable/refreshable.
 */
export const SENSITIVE_URL_FILTER_KEYS = [
  "metaDataColumn",
  "metaDataValue",
  "metaDataOperator",
] as const;

/** True when the URL carries any PHI-shaped metadata-search param. */
export function hasSensitiveUrlParams(searchParams: URLSearchParams): boolean {
  return SENSITIVE_URL_FILTER_KEYS.some((key) => searchParams.has(key));
}

/**
 * Return a query string with the PHI-shaped metadata-search params removed and
 * every other param preserved in its original order. Includes a
 * leading `?` only when at least one param remains; returns `""` otherwise.
 */
export function stripSensitiveUrlParams(searchParams: URLSearchParams): string {
  const cleaned = new URLSearchParams(searchParams);
  for (const key of SENSITIVE_URL_FILTER_KEYS) cleaned.delete(key);
  const query = cleaned.toString();
  return query ? `?${query}` : "";
}

export function useUrlFilterParams(): { params: UrlFilterParams; hasAny: boolean } {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const params: UrlFilterParams = {
      messageId: searchParams.get("messageId"),
      minMessageId: searchParams.get("minMessageId"),
      maxMessageId: searchParams.get("maxMessageId"),
      metaDataColumn: searchParams.get("metaDataColumn"),
      metaDataValue: searchParams.get("metaDataValue"),
      metaDataOperator: searchParams.get("metaDataOperator"),
    };
    return {
      params,
      hasAny: !!(
        params.messageId ||
        params.minMessageId ||
        params.maxMessageId ||
        params.metaDataColumn
      ),
    };
  }, [searchParams]);
}
