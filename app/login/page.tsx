"use client";

import { useState, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn, signUp } from "./actions";

export default function LoginPage() {
  const [tab, setTab] = useState<"signin" | "signup">("signin");
  const [signInState, signInAction] = useActionState(signIn, null);
  const [signUpState, signUpAction] = useActionState(signUp, null);

  const isSignIn = tab === "signin";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">Beacon</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isSignIn ? "Sign in to your account" : "Create a new account"}
          </p>
        </div>

        {/* Tab toggle */}
        <div className="flex rounded-lg border border-border p-1 gap-1">
          <button
            type="button"
            onClick={() => setTab("signin")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              isSignIn
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              !isSignIn
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Sign up
          </button>
        </div>

        {/* Sign-in form */}
        {isSignIn && (
          <form action={signInAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signin-email">Email</Label>
              <Input
                id="signin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signin-password">Password</Label>
              <Input
                id="signin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
              />
            </div>
            {signInState && "error" in signInState && (
              <p className="text-sm text-destructive">{signInState.error}</p>
            )}
            <Button type="submit" className="w-full">
              Sign in
            </Button>
          </form>
        )}

        {/* Sign-up form */}
        {!isSignIn && (
          <form action={signUpAction} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="signup-email">Email</Label>
              <Input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="signup-password">Password</Label>
              <Input
                id="signup-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                placeholder="min 6 characters"
                minLength={6}
              />
            </div>
            {signUpState && "error" in signUpState && (
              <p className="text-sm text-destructive">{signUpState.error}</p>
            )}
            {signUpState && "message" in signUpState && (
              <p className="text-sm text-muted-foreground">
                {signUpState.message}
              </p>
            )}
            <Button type="submit" className="w-full">
              Create account
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
