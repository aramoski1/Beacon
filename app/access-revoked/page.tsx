import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BeaconBrand } from "@/components/beacon-logo";

export default function AccessRevokedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center mb-2">
          <BeaconBrand logoClassName="size-9" className="gap-3 [&>span]:text-xl" />
        </div>

        <div className="flex justify-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <ShieldAlert className="size-6 text-destructive" />
          </div>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Access revoked</h1>
          <p className="text-sm text-muted-foreground">
            Your access to Beacon has been revoked. Contact your admin if you believe this is a mistake.
          </p>
        </div>

        <Link href="/login" className={buttonVariants({ className: "w-full" })}>
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
