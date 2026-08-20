"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Mail, X, Loader2, ShieldCheck, Shield, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  inviteTeammate,
  revokeInvitation,
  resendInvitation,
  removeMember,
  changeMemberRole,
  leaveFirm,
  type TeamData,
  type TeamMember,
} from "./actions";

const ROLE_LABELS: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member" };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function TeamView({ data }: { data: TeamData }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMember | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  const canManage = data.myRole === "owner" || data.myRole === "admin";
  const isOwner = data.myRole === "owner";

  function refresh() {
    startTransition(() => {
      window.location.reload();
    });
  }

  function handleInvite(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await inviteTeammate(formData);
      if (result.error) { setError(result.error); return; }
      setInviting(false);
      refresh();
    });
  }

  function handleRevoke(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitation(id);
      if (result.error) setError(result.error);
      else refresh();
    });
  }

  function handleResend(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await resendInvitation(id);
      if (result.error) setError(result.error);
      else refresh();
    });
  }

  function handleRoleChange(memberRowId: string, newRole: "admin" | "member") {
    setError(null);
    startTransition(async () => {
      const result = await changeMemberRole(memberRowId, newRole);
      if (result.error) setError(result.error);
      else refresh();
    });
  }

  function handleRemoveConfirm() {
    if (!removeTarget) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMember(removeTarget.id);
      setRemoveTarget(null);
      if (result.error) setError(result.error);
      else refresh();
    });
  }

  function handleLeaveConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await leaveFirm();
      setLeaveConfirm(false);
      if (result.error) setError(result.error);
      else window.location.href = "/settings";
    });
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-3.5" />
        Settings
      </Link>

      <div>
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="size-5" />
          {data.firmName ?? "Your team"}
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {data.isSoloFirm
            ? "Just you for now — invite a teammate to start sharing your pipeline."
            : `${data.members.length} member${data.members.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center justify-between gap-2">
          {error}
          <button type="button" onClick={() => setError(null)} className="text-destructive/70 hover:text-destructive">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* Roster */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/30">
          <p className="text-xs font-semibold text-muted-foreground">Members</p>
        </div>
        <div className="divide-y">
          {data.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {m.displayName ?? "Unnamed broker"}
                  {m.isMe && <span className="text-muted-foreground font-normal"> (you)</span>}
                </p>
              </div>
              {isOwner && !m.isMe && m.role !== "owner" ? (
                <select
                  value={m.role}
                  disabled={isPending}
                  onChange={(e) => handleRoleChange(m.id, e.target.value as "admin" | "member")}
                  className="h-7 text-xs rounded-md border bg-background px-2"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              ) : (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 shrink-0",
                    m.role === "owner"
                      ? "bg-primary/10 text-primary"
                      : m.role === "admin"
                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {m.role === "owner" ? <ShieldCheck className="size-3" /> : m.role === "admin" ? <Shield className="size-3" /> : null}
                  {ROLE_LABELS[m.role]}
                </span>
              )}
              {canManage && !m.isMe && m.role !== "owner" && (
                <button
                  type="button"
                  onClick={() => setRemoveTarget(m)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  title="Remove from firm"
                >
                  <X className="size-3.5" />
                </button>
              )}
              {m.isMe && m.role !== "owner" && (
                <button
                  type="button"
                  onClick={() => setLeaveConfirm(true)}
                  disabled={isPending}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  Leave
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Pending invitations */}
      {canManage && data.pendingInvitations.length > 0 && (
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground">Pending invitations</p>
          </div>
          <div className="divide-y">
            {data.pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <Mail className="size-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[inv.role]} · expires {fmtDate(inv.expiresAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleResend(inv.id)}
                  disabled={isPending}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title="Extend expiry by 7 days"
                >
                  <RotateCcw className="size-3" />
                  Resend
                </button>
                <button
                  type="button"
                  onClick={() => handleRevoke(inv.id)}
                  disabled={isPending}
                  className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                  title="Revoke invitation"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invite form */}
      {canManage && (
        <div className="rounded-xl border bg-card p-4">
          {!inviting ? (
            <button
              type="button"
              onClick={() => setInviting(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline underline-offset-2"
            >
              + Invite a teammate
            </button>
          ) : (
            <form action={handleInvite} className="space-y-3">
              <p className="text-sm font-medium">Invite a teammate</p>
              <div className="flex gap-2 flex-wrap">
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="teammate@brokerage.com"
                  disabled={isPending}
                  className="flex-1 min-w-[12rem] h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 ring-ring"
                />
                <select name="role" defaultValue="member" disabled={isPending} className="h-9 rounded-md border bg-background px-2 text-sm">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                Creates an invite link — send it to them yourself (email, Slack, text). It expires in 7 days.
              </p>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isPending && <Loader2 className="size-3 animate-spin" />}
                  Send invite
                </button>
                <button
                  type="button"
                  onClick={() => setInviting(false)}
                  disabled={isPending}
                  className="h-8 px-3 text-xs rounded-md border text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {removeTarget && (
        <ConfirmDialog
          title="Remove teammate"
          message={`Remove ${removeTarget.displayName ?? "this teammate"} from ${data.firmName ?? "the firm"}? Their own records stay theirs, but anything they shared with the team stops being visible to them immediately.`}
          confirmLabel="Remove"
          danger
          busy={isPending}
          onCancel={() => setRemoveTarget(null)}
          onConfirm={handleRemoveConfirm}
        />
      )}

      {leaveConfirm && (
        <ConfirmDialog
          title="Leave this firm"
          message="You'll lose access to everything your teammates shared with the firm, and anything you shared with them stops being visible too. Your own records stay exactly as they are."
          confirmLabel="Leave"
          danger
          busy={isPending}
          onCancel={() => setLeaveConfirm(false)}
          onConfirm={handleLeaveConfirm}
        />
      )}
    </main>
  );
}
