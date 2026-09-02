"use client";

import { useState, useTransition } from "react";
import { Shield, Plus, Trash2, Check, X, Loader2, ShieldAlert } from "lucide-react";
import {
  addApprovedEmail,
  removeApprovedEmail,
  approveAccessRequest,
  dismissAccessRequest,
  type ApprovedEmail,
  type AccessRequest,
  type AdminAccount,
} from "./actions";
import AccountDetail from "./account-detail";

const inputCls = "w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ring-ring bg-background";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function AdminView({
  initialApprovedEmails,
  initialAccessRequests,
  initialAccounts,
}: {
  initialApprovedEmails: ApprovedEmail[];
  initialAccessRequests: AccessRequest[];
  initialAccounts: AdminAccount[];
}) {
  const [approvedEmails, setApprovedEmails] = useState(initialApprovedEmails);
  const [accessRequests, setAccessRequests] = useState(initialAccessRequests);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const selectedAccount = accounts.find((a) => a.userId === selectedAccountId) ?? null;
  const [newEmail, setNewEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email) return;
    setAddError(null);
    startTransition(async () => {
      const res = await addApprovedEmail(email);
      if ("error" in res) {
        setAddError(res.error);
        return;
      }
      setApprovedEmails((prev) => [res.entry, ...prev]);
      setNewEmail("");
    });
  }

  function handleRemove(id: string) {
    setApprovedEmails((prev) => prev.filter((e) => e.id !== id));
    startTransition(async () => {
      await removeApprovedEmail(id);
    });
  }

  function handleApprove(req: AccessRequest) {
    setAccessRequests((prev) => prev.filter((r) => r.id !== req.id));
    startTransition(async () => {
      const res = await approveAccessRequest(req.id, req.email);
      if ("error" in res || !res.entry) return;
      setApprovedEmails((prev) => [res.entry as ApprovedEmail, ...prev]);
    });
  }

  function handleDismiss(id: string) {
    setAccessRequests((prev) => prev.filter((r) => r.id !== id));
    startTransition(async () => {
      await dismissAccessRequest(id);
    });
  }

  function handleStatusChange(userId: string, revokedAt: string | null) {
    setAccounts((prev) => prev.map((a) => (a.userId === userId ? { ...a, accessRevokedAt: revokedAt } : a)));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      <header className="shrink-0 border-b px-4 py-3 sm:px-6 flex items-center gap-3">
        <Shield className="size-4 text-muted-foreground" />
        <h1 className="text-xl font-semibold tracking-tight">Admin</h1>
        <span className="text-xs text-muted-foreground">Manage invite-only access</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 space-y-6">
          {/* ── Access requests ──────────────────────────────────────────────── */}
          {accessRequests.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
                Pending access requests ({accessRequests.length})
              </p>
              <div className="space-y-1.5">
                {accessRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between gap-2 rounded-md bg-background/60 border px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{req.email}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(req.requestedAt)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleApprove(req)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 text-xs font-medium bg-primary text-primary-foreground rounded-md px-2.5 py-1.5 disabled:opacity-50"
                      >
                        <Check className="size-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismiss(req.id)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground border rounded-md px-2.5 py-1.5 hover:bg-muted/50 disabled:opacity-50"
                      >
                        <X className="size-3.5" />
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Approved emails ──────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold">Approved emails</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Only these emails can create a Beacon account.
              </p>
            </div>

            <form onSubmit={handleAdd} className="flex items-center gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="broker@example.com"
                className={inputCls}
              />
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex items-center gap-1.5 shrink-0 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Add
              </button>
            </form>
            {addError && <p className="text-xs text-destructive">{addError}</p>}

            {approvedEmails.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No approved emails yet.</p>
            ) : (
              <div className="divide-y border rounded-md">
                {approvedEmails.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm truncate">{e.email}</p>
                      <p className="text-xs text-muted-foreground">Added {fmtDate(e.createdAt)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(e.id)}
                      disabled={isPending}
                      className="p-1.5 text-muted-foreground hover:text-destructive shrink-0"
                      title="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Accounts ─────────────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="p-5 pb-0">
              <h2 className="text-sm font-semibold">Accounts ({accounts.length})</h2>
              <p className="text-xs text-muted-foreground mt-0.5 mb-4">
                Every account that has been created. This shows identity only — not the contents of anyone&apos;s book.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="text-left font-medium px-5 py-2">Email</th>
                    <th className="text-left font-medium px-3 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2">Firm</th>
                    <th className="text-left font-medium px-3 py-2">Status</th>
                    <th className="text-right font-medium px-5 py-2">Signed up</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr
                      key={a.userId}
                      onClick={() => setSelectedAccountId(a.userId)}
                      className="border-b last:border-0 cursor-pointer hover:bg-muted/40 transition-colors"
                    >
                      <td className="px-5 py-2 truncate max-w-[220px]">{a.email}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.displayName ?? a.company ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.firmName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {a.accessRevokedAt ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                            <ShieldAlert className="size-3" />
                            Revoked
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Active</span>
                        )}
                      </td>
                      <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{fmtDate(a.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {selectedAccount && (
        <AccountDetail
          key={selectedAccount.userId}
          account={selectedAccount}
          onClose={() => setSelectedAccountId(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
