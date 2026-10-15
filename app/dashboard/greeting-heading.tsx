"use client";

function greetingPrefix(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Local clock for the hero — suppressHydrationWarning because SSR TZ may differ. */
export function GreetingHeading({ name }: { name: string | null }) {
  const text = name
    ? `${greetingPrefix(new Date().getHours())}, ${name}`
    : greetingPrefix(new Date().getHours());
  return (
    <h1 suppressHydrationWarning className="text-xl font-semibold tracking-tight">
      {text}
    </h1>
  );
}
