import Link from "next/link";
import Image from "next/image";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center">
      <Image
        src="/bridgelink-logo.png"
        alt="BridgeLink"
        width={256}
        height={64}
        priority
        className="h-16 w-auto"
      />
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-8 py-10">
        <p className="text-5xl font-semibold tracking-tight text-foreground">404</p>
        <p className="text-base font-medium text-foreground">Page not found</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have been moved.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link href="/">
            <Home className="mr-1.5 h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
