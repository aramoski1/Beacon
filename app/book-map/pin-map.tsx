"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export type MapPin = {
  id: string;
  address: string | null;
  lat: number;
  lng: number;
};

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
        L.marker([p.lat, p.lng])
          .addTo(m)
          .bindPopup(
            `<a href="/properties/${p.id}">${(p.address ?? "Property").replace(/</g, "")}</a>`,
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
    };
  }
}
