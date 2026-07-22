"use client";

import { useState, useEffect } from "react";
import { getAvailableCharsetEncodings } from "@/lib/api-client";

// Module-level singleton — the server charset list is fetched once per app session
// (it never changes for a running server) and shared across every connector's
// "Encoding" dropdown. Mirrors how the Java client fetches the charset list once.
let _cache: string[] | null = null;
let _promise: Promise<string[]> | null = null;

function load(): Promise<string[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = getAvailableCharsetEncodings()
    .then((charsets) => {
      _cache = charsets;
      return _cache;
    })
    .catch(() => {
      _promise = null; // allow retry on next mount
      return [];
    });
  return _promise;
}

/** Call on logout so a different server's charset list isn't reused after re-login. */
export function clearCharsetCache() {
  _cache = null;
  _promise = null;
}

/**
 * Returns the server-provided list of supported charset encodings (cached once per
 * session). Empty until the fetch resolves; callers prepend the "Default" option via
 * buildCharsetOptions().
 */
export function useCharsetEncodings(): string[] {
  const [charsets, setCharsets] = useState<string[]>(_cache ?? []);
  useEffect(() => {
    load().then(setCharsets);
  }, []);
  return charsets;
}
