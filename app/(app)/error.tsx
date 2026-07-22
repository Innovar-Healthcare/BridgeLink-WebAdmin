"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[AppError boundary]", error);
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4 p-8">
      <div className="flex flex-col items-center gap-3 max-w-md w-full rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-6 py-8 text-center">
        <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400 shrink-0" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">Something went wrong</p>
          <p className="text-xs text-red-600 dark:text-red-400">
            An unexpected error occurred. You can try again or refresh the page.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={reset}
          className="mt-1 border-red-300 dark:border-red-600 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/50"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Try Again
        </Button>
      </div>
    </div>
  );
}
