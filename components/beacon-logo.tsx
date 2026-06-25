import { cn } from "@/lib/utils";

export function BeaconLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <rect width="512" height="512" rx="116" fill="#14233B" />
      <g transform="translate(176,150)" strokeLinecap="round" strokeLinejoin="round">
        <path d="M40 230 L75 70 L105 70 L140 230 Z" stroke="#F4F6FA" strokeWidth="20" fill="none" />
        <circle cx="90" cy="42" r="26" fill="#E8A33D" />
        <path d="M128 18 L168 0 M128 66 L168 84" stroke="#E8A33D" strokeWidth="11" fill="none" />
        <path d="M52 18 L12 0 M52 66 L12 84" stroke="#E8A33D" strokeWidth="11" fill="none" />
      </g>
    </svg>
  );
}

export function BeaconBrand({
  className,
  logoClassName,
  showWordmark = true,
}: {
  className?: string;
  logoClassName?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <BeaconLogo className={cn("size-6", logoClassName)} />
      {showWordmark && (
        <span className="font-semibold tracking-tight text-sm">Beacon</span>
      )}
    </div>
  );
}
