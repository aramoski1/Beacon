"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { ModuleId } from "@/lib/dashboard-layout";
import { BrokerKpiStrip } from "./dashboard-kpi-strip";

type VisibleMap = Record<ModuleId, boolean>;

const DashboardVisibilityContext = createContext<{
  visible: VisibleMap;
  setVisible: (next: VisibleMap) => void;
} | null>(null);

export function DashboardVisibilityProvider({
  initialVisible,
  children,
}: {
  initialVisible: VisibleMap;
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(initialVisible);

  useEffect(() => {
    setVisible(initialVisible);
  }, [initialVisible]);

  const value = useMemo(() => ({ visible, setVisible }), [visible]);
  return (
    <DashboardVisibilityContext.Provider value={value}>
      {children}
    </DashboardVisibilityContext.Provider>
  );
}

export function useDashboardVisible() {
  const ctx = useContext(DashboardVisibilityContext);
  if (!ctx) {
    throw new Error("useDashboardVisible must be used within DashboardVisibilityProvider");
  }
  return ctx;
}

export function IfVisible({
  id,
  when = true,
  children,
}: {
  id: ModuleId;
  when?: boolean;
  children: ReactNode;
}) {
  const { visible } = useDashboardVisible();
  if (!visible[id] || !when) return null;
  return <>{children}</>;
}

export function IfAnyVisible({
  ids,
  require,
  children,
}: {
  ids: readonly ModuleId[];
  require?: Partial<Record<ModuleId, boolean>>;
  children: ReactNode;
}) {
  const { visible } = useDashboardVisible();
  const any = ids.some((id) => visible[id] && require?.[id] !== false);
  if (!any) return null;
  return <>{children}</>;
}

export function IfNoneVisible({
  ids,
  require,
  children,
}: {
  ids: readonly ModuleId[];
  require?: Partial<Record<ModuleId, boolean>>;
  children: ReactNode;
}) {
  const { visible } = useDashboardVisible();
  const any = ids.some((id) => visible[id] && require?.[id] !== false);
  if (any) return null;
  return <>{children}</>;
}

export function VisibleKpiStrip(
  props: Omit<ComponentProps<typeof BrokerKpiStrip>, "visible">,
) {
  const { visible } = useDashboardVisible();
  return (
    <BrokerKpiStrip
      {...props}
      visible={{
        kpi_pursuits: visible.kpi_pursuits,
        kpi_leases_90: visible.kpi_leases_90,
        kpi_tier1_overdue: visible.kpi_tier1_overdue,
        kpi_ownership: visible.kpi_ownership,
        kpi_book: visible.kpi_book,
      }}
    />
  );
}
