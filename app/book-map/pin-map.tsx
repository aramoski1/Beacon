"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export type MapPin = {
  id: string;
  address: string | null;
  lat: number;
  lng: number;
  propertyType?: string | null;
};

const TYPE_COLOR: Record<string, string> = {
  industrial: "#2563eb",
  warehouse: "#2563eb",
  flex: "#0d9488",
  office: "#7c3aed",
  retail: "#d97706",
  land: "#16a34a",
  multifamily: "#db2777",
};

function pinColor(type: string | null | undefined): string {
  if (!type) return "#64748b";
  return TYPE_COLOR[type.toLowerCase()] ?? "#64748b";
}

export function BookPinMap({ pins }: { pins: MapPin[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || pins.length === 0) return;
    const el = ref.current;
    let map: { remove: () => void } | null = null;
    let cancelled = false;

    async function boot() {
      if (!document.querySelector("link[data-leaflet]")) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        link.setAttribute("data-leaflet", "1");
        document.head.appendChild(link);
      }
      await new Promise<void>((resolve, reject) => {
        if (window.L) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("leaflet load"));
        document.body.appendChild(s);
      });
      if (cancelled || !el || !window.L) return;
      const L = window.L;
      const m = L.map(el).setView([pins[0].lat, pins[0].lng], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
      }).addTo(m);
      const bounds: [number, number][] = [];
      for (const p of pins) {
        const color = pinColor(p.propertyType);
        L.circleMarker([p.lat, p.lng], {
          radius: 7,
          color,
          fillColor: color,
          fillOpacity: 0.9,
          weight: 1,
        })
          .addTo(m)
          .bindPopup(
            `<a href="/properties/${p.id}">${(p.address ?? "Property").replace(/</g, "")}</a><br/><span style="color:#94a3b8">${(p.propertyType ?? "Property").replace(/</g, "")}</span>`,
          );
        bounds.push([p.lat, p.lng]);
      }
      if (bounds.length > 1) m.fitBounds(bounds, { padding: [24, 24] });
      map = m;
    }

    boot().catch(() => {});
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [pins]);

  if (pins.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No geocoded properties yet. Use <strong>Geocode missing pins</strong> above, then refresh.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div ref={ref} className="h-[28rem] w-full rounded-xl border overflow-hidden z-0" />
      <p className="text-[11px] text-muted-foreground">
        {pins.length} pin{pins.length === 1 ? "" : "s"} ·{" "}
        <Link href="https://www.openstreetmap.org/copyright" className="underline" target="_blank">
          OSM
        </Link>
      </p>
    </div>
  );
}

type LeafletMap = {
  setView: (ll: [number, number], z: number) => LeafletMap;
  fitBounds: (b: [number, number][], o: { padding: [number, number] }) => void;
  remove: () => void;
};

declare global {
  interface Window {
    L?: {
      map: (el: HTMLElement) => LeafletMap;
      tileLayer: (url: string, opts: { attribution: string }) => { addTo: (m: LeafletMap) => void };
      marker: (ll: [number, number]) => { addTo: (m: LeafletMap) => { bindPopup: (html: string) => void } };
      circleMarker: (
        ll: [number, number],
        opts: { radius: number; color: string; fillColor: string; fillOpacity: number; weight: number },
      ) => { addTo: (m: LeafletMap) => { bindPopup: (html: string) => void } };
    };
  }
}
