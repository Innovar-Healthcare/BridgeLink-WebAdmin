"use client";

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// global-error.tsx replaces the entire root layout when it crashes,
// so it must render its own <html> and <body>.
// Tailwind classes are not reliable here (CSS may not have loaded),
// so styles are inlined.
export default function GlobalError({ error }: GlobalErrorProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[GlobalError boundary]", error);
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          backgroundColor: "#f9fafb",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            maxWidth: "400px",
            width: "100%",
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            padding: "32px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ margin: 0, fontSize: "14px", fontWeight: 500, color: "#b91c1c" }}>
            Something went wrong
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#dc2626" }}>
            A critical error occurred. Please reload the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "4px",
              padding: "6px 16px",
              fontSize: "13px",
              borderRadius: "6px",
              border: "1px solid #fca5a5",
              backgroundColor: "transparent",
              color: "#b91c1c",
              cursor: "pointer",
            }}
          >
            Reload Page
          </button>
        </div>
      </body>
    </html>
  );
}
