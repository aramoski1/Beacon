"use client";

import { useEffect, useState, useTransition } from "react";
import { X, ShieldAlert, ShieldCheck, Loader2, Clock } from "lucide-react";
import {
  revokeAccountAccess,
  restoreAccountAccess,
  getAccountActivity,
  type AdminAccount,
  type ActivityEntry,
} from "./actions";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AccountDetail({
  account,
  onClose,
  onStatusChange,
}: {
  account: AdminAccount;
  onClose: () => void;
  onStatusChange: (userId: string, revokedAt: string | null) => void;
}) {
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  const [activity, setActivity] = useState<ActivityEntry[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const isRevoked = Boolean(account.accessRevokedAt);

  useEffect(() => {
    getAccountActivity(account.userId).then((res) => {
      if ("error" in res) {
        setActivityError(res.error);
        return;
      }
      setActivity(res);
      setHasMore(res.length > 0);
    });
  }, [account.userId]);

  function handleLoadMore() {
    if (!activity || activity.length === 0) return;
    setLoadingMore(true);
    const before = activity[activity.length - 1].createdAt;
    getAccountActivity(account.userId, before).then((res) => {
      setLoadingMore(false);
      if ("error" in res) {
        setActivityError(res.error);
        return;
      }
      setActivity((prev) => [...(prev ?? []), ...res]);
      setHasMore(res.length > 0);
    });
  }

  function handleRevoke() {
    setActionError(null);
    startTransition(async () => {
      const res = await revokeAccountAccess(account.userId);
      if ("error" in res) {
        setActionError(res.error);
        return;
      }
      setConfirmingRevoke(false);
      onStatusChange(account.userId, new Date().toISOString());
    });
  }

  function handleRestore() {
    setActionError(null);
    startTransition(async () => {
      const res = await restoreAccountAccess(account.userId);
      if ("error" in res) {
        setActionError(res.error);
        return;
      }
      onStatusChange(account.userId, null);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
      />
      <div className="relative w-full max-w-md h-full bg-background border-l shadow-xl flex flex-col overflow-hidden">
        <div className="shrink-0 border-b px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{account.displayName ?? account.email}</p>
            <p className="text-xs text-muted-foreground truncate">{account.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {/* ── Status ─────────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              {isRevoked ? (
                <ShieldAlert className="size-4 text-destructive" />
              ) : (
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-500" />
              )}
              <span className="text-sm font-medium">{isRevoked ? "Revoked" : "Active"}</span>
              {isRevoked && account.accessRevokedAt && (
                <span className="text-xs text-muted-foreground">since {fmtDateTime(account.accessRevokedAt)}</span>
              )}
            </div>

            {actionError && <p className="text-xs text-destructive">{actionError}</p>}

            {isRevoked ? (
              <button
                type="button"
                onClick={handleRestore}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-md px-3 py-1.5 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                Restore access
              </button>
            ) : confirmingRevoke ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-medium bg-destructive text-destructive-foreground rounded-md px-3 py-1.5 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldAlert className="size-3.5" />}
                  Confirm revoke
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRevoke(false)}
                  disabled={isPending}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRevoke(true)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive border border-destructive/30 rounded-md px-3 py-1.5 hover:bg-destructive/5"
              >
                <ShieldAlert className="size-3.5" />
                Revoke access
              </button>
            )}

            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Revoking blocks sign-in immediately and signs the account out on its next page load. It&apos;s
              reversible — restore at any time.
            </p>
          </div>

          {/* ── Identity ───────────────────────────────────────────────── */}
          <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Firm</span>
              <span className="truncate">{account.firmName ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Signed up</span>
              <span>{fmtDateTime(account.createdAt)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Last active</span>
              <span>{account.lastActiveAt ? fmtDateTime(account.lastActiveAt) : "—"}</span>
            </div>
          </div>

          {/* ── Activity ───────────────────────────────────────────────── */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Activity
            </h3>
            {activityError && <p className="text-xs text-destructive">{activityError}</p>}
            {activity === null && !activityError && (
              <p className="text-sm text-muted-foreground py-2">Loading…</p>
            )}
            {activity !== null && activity.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No recorded activity yet.</p>
            )}
            {activity !== null && activity.length > 0 && (
              <div className="rounded-lg border divide-y">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    <Clock className="size-3.5 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.path}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {fmtDateTime(entry.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {activity !== null && activity.length > 0 && hasMore && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full text-xs text-muted-foreground hover:text-foreground border rounded-md py-1.5 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
