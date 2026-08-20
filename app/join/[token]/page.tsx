import Link from "next/link";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getInvitationPreview } from "./actions";
import { AcceptButton } from "./accept-button";

export const metadata = { title: "Join a team – Beacon" };

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const preview = await getInvitationPreview(token);

  return (
    <main className="mx-auto max-w-md px-4 py-16 sm:px-6 text-center space-y-6">
      <Users className="size-10 mx-auto text-primary" />

      {!user ? (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">You&apos;ve been invited to a team on Beacon</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in or create an account with the email address the invite was sent to, then come back to this
              same link to accept.
            </p>
          </div>
          <Link
            href="/login"
            className="inline-flex items-center h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90"
          >
            Sign in / Create account
          </Link>
        </>
      ) : preview ? (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Join {preview.firmName ?? "this team"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              You&apos;ve been invited as a <strong>{preview.role}</strong>. Your existing data stays exactly as private
              as it is today — joining only changes who you can share new records with.
            </p>
          </div>
          <AcceptButton token={token} firmName={preview.firmName} />
        </>
      ) : (
        <>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">This invitation isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It may have expired, already been used, been revoked, or been sent to a different email than{" "}
              <strong>{user.email}</strong>. Ask whoever invited you to send a new one.
            </p>
          </div>
          <Link
            href="/crm"
            className="inline-flex items-center h-10 px-4 rounded-md border text-sm font-medium hover:bg-muted/50"
          >
            Go to Beacon
          </Link>
        </>
      )}
    </main>
  );
}
