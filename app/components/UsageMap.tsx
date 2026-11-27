"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Reveal from "./Reveal";

type City = { name: string; lat: number; lon: number; weight: number; share: string };

// Placeholder usage data — invented for the purpose of this section.
const CITIES: City[] = [
  { name: "San Francisco", lat: 37.77, lon: -122.42, weight: 1, share: "18%" },
  { name: "New York", lat: 40.71, lon: -74.0, weight: 0.72, share: "11%" },
  { name: "Toronto", lat: 43.65, lon: -79.38, weight: 0.4, share: "4%" },
  { name: "São Paulo", lat: -23.55, lon: -46.63, weight: 0.35, share: "3%" },
  { name: "London", lat: 51.51, lon: -0.13, weight: 0.82, share: "13%" },
  { name: "Amsterdam", lat: 52.37, lon: 4.9, weight: 0.48, share: "5%" },
  { name: "Berlin", lat: 52.52, lon: 13.4, weight: 0.55, share: "6%" },
  { name: "Warsaw", lat: 52.23, lon: 21.0, weight: 0.3, share: "3%" },
  { name: "Tel Aviv", lat: 32.08, lon: 34.78, weight: 0.42, share: "4%" },
  { name: "Bangalore", lat: 12.97, lon: 77.59, weight: 0.65, share: "9%" },
  { name: "Singapore", lat: 1.35, lon: 103.82, weight: 0.5, share: "6%" },
  { name: "Tokyo", lat: 35.68, lon: 139.69, weight: 0.46, share: "5%" },
  { name: "Sydney", lat: -33.87, lon: 151.21, weight: 0.34, share: "3%" },
];

// Approximate landmass coastlines in [lon, lat] pairs, used to scatter dots
// so the flat map actually reads as a world map instead of arbitrary blobs.
const LANDMASSES: { points: [number, number][]; n: number }[] = [
  {
    // North America
    n: 140,
    points: [
      [-165, 68], [-155, 71], [-130, 70], [-100, 75], [-80, 73], [-65, 65],
      [-55, 52], [-52, 48], [-60, 45], [-67, 44], [-70, 41], [-74, 40],
      [-76, 35], [-80, 26], [-82, 24], [-90, 16], [-97, 16], [-92, 14],
      [-88, 13], [-84, 9], [-79, 8], [-77, 7], [-83, 10], [-87, 13],
      [-94, 18], [-105, 21], [-110, 24], [-115, 29], [-117, 32], [-122, 37],
      [-124, 41], [-124, 46], [-125, 49], [-130, 55], [-140, 60], [-165, 68],
    ],
  },
  {
    // South America
    n: 90,
    points: [
      [-77, 8], [-72, 11], [-60, 10], [-51, 4], [-49, -1], [-35, -9],
      [-38, -13], [-40, -20], [-41, -23], [-48, -26], [-57, -34], [-62, -39],
      [-68, -45], [-73, -52], [-75, -46], [-71, -38], [-70, -30], [-71, -20],
      [-75, -14], [-81, -4], [-80, 3], [-77, 8],
    ],
  },
  {
    // Europe
    n: 60,
    points: [
      [-9, 43], [-9, 50], [-5, 48], [2, 51], [5, 53], [9, 54], [11, 55],
      [18, 55], [24, 60], [28, 60], [30, 55], [38, 48], [35, 45], [27, 42],
      [23, 40], [15, 38], [9, 44], [3, 43], [-2, 37], [-9, 37], [-9, 43],
    ],
  },
  {
    // Africa
    n: 130,
    points: [
      [-17, 21], [-16, 28], [-9, 33], [-5, 35], [10, 37], [20, 33], [25, 32],
      [33, 31], [35, 28], [36, 22], [43, 13], [51, 12], [45, 5], [41, -2],
      [40, -11], [35, -19], [35, -26], [32, -29], [27, -33], [20, -34],
      [16, -29], [12, -18], [9, -5], [9, 4], [-2, 5], [-8, 5], [-11, 7],
      [-13, 9], [-16, 13], [-17, 21],
    ],
  },
  {
    // Asia (incl. Middle East, India, China, SE Asia, Siberia)
    n: 170,
    points: [
      [27, 70], [40, 70], [60, 73], [75, 73], [90, 76], [105, 77], [130, 75],
      [150, 72], [170, 68], [179, 66], [170, 60], [160, 55], [150, 48],
      [142, 45], [130, 40], [122, 31], [121, 25], [110, 18], [106, 10],
      [100, 6], [95, 5], [92, 15], [80, 7], [77, 8], [73, 15], [68, 24],
      [61, 25], [57, 27], [50, 29], [48, 30], [44, 33], [38, 37], [35, 36],
      [27, 37], [27, 45], [27, 55], [27, 70],
    ],
  },
  {
    // Australia
    n: 50,
    points: [
      [113, -22], [114, -20], [122, -17], [130, -12], [136, -12], [142, -11],
      [145, -15], [148, -20], [153, -25], [153, -29], [150, -34], [147, -38],
      [140, -38], [136, -35], [132, -32], [126, -32], [115, -34], [113, -27],
      [113, -22],
    ],
  },
];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ray-casting point-in-polygon test, run directly in lon/lat space.
function pointInPolygon(lon: number, lat: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function sampleLandmass(poly: [number, number][], n: number, rand: () => number) {
  const lons = poly.map((p) => p[0]);
  const lats = poly.map((p) => p[1]);
  const lonMin = Math.min(...lons);
  const lonMax = Math.max(...lons);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const out: { lon: number; lat: number }[] = [];
  let attempts = 0;
  while (out.length < n && attempts < n * 50) {
    attempts++;
    const lon = lonMin + rand() * (lonMax - lonMin);
    const lat = latMin + rand() * (latMax - latMin);
    if (pointInPolygon(lon, lat, poly)) out.push({ lon, lat });
  }
  return out;
}

// Equirectangular projection matching the flat map's 100x50 viewBox
// (100 wide = full 360° of longitude, 50 tall = full 180° of latitude).
function lonLatToPct(lon: number, lat: number) {
  return { x: ((lon + 180) / 360) * 100, y: ((90 - lat) / 180) * 50 };
}

export default function UsageMap() {
  const [view, setView] = useState<"globe" | "flat">("globe");
  const [rotation, setRotation] = useState(-20);
  const dragging = useRef<{ x: number; r: number } | null>(null);
  const [paused, setPaused] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "globe" || paused) return;
    let raf: number;
    const tick = () => {
      setRotation((r) => r + 0.06);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [view, paused]);

  const dots = useMemo(() => {
    const rand = mulberry32(7);
    const out: { x: number; y: number }[] = [];
    for (const land of LANDMASSES) {
      const pts = sampleLandmass(land.points, land.n, rand);
      for (const p of pts) {
        out.push(lonLatToPct(p.lon, p.lat));
      }
    }
    return out;
  }, []);

  const globeCities = useMemo(() => {
    return CITIES.map((c) => {
      const latRad = (c.lat * Math.PI) / 180;
      const lonRad = ((c.lon - rotation) * Math.PI) / 180;
      const x = 100 + 84 * Math.cos(latRad) * Math.sin(lonRad);
      const y = 100 - 84 * Math.sin(latRad);
      const z = Math.cos(latRad) * Math.cos(lonRad);
      return { ...c, x, y, z };
    });
  }, [rotation]);

  const meridians = [0, 60, 120].map((m) => {
    const angle = ((rotation + m) * Math.PI) / 180;
    return Math.abs(84 * Math.sin(angle));
  });

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragging.current = { x: e.clientX, r: rotation };
    setPaused(true);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.x;
    setRotation(dragging.current.r + dx * 0.4);
  }
  function onPointerUp() {
    dragging.current = null;
    setTimeout(() => setPaused(false), 1200);
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-20">
      <Reveal direction="up" className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Wherever your team ships from.
          </h2>
          <p className="mt-4 text-ink-soft">
            Drag to look around — this is where DevAudit's usage is heaviest right now.
          </p>
        </div>
        <div className="flex shrink-0 rounded-full border border-border bg-bg-elevated p-1 text-sm">
          {(["globe", "flat"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-full px-4 py-1.5 capitalize transition-colors duration-200 ${
                view === v ? "bg-ink text-bg" : "text-ink-soft hover:text-ink"
              }`}
            >
              {v === "flat" ? "Flat map" : "Globe"}
            </button>
          ))}
        </div>
      </Reveal>

      <div className="relative overflow-hidden rounded-2xl border border-surface-dark-border bg-surface-dark">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-cyan/10 blur-[100px]"
        />
        <AnimatePresence mode="wait">
          {view === "globe" ? (
            <motion.div
              key="globe"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="relative flex justify-center px-4 py-10 sm:py-14"
            >
              <svg
                viewBox="0 0 200 200"
                className="h-[300px] w-[300px] cursor-grab touch-none select-none active:cursor-grabbing sm:h-[380px] sm:w-[380px]"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              >
                <defs>
                  <radialGradient id="globe-sphere" cx="35%" cy="30%" r="75%">
                    <stop offset="0%" stopColor="#1e2536" />
                    <stop offset="55%" stopColor="#12151c" />
                    <stop offset="100%" stopColor="#0a0c11" />
                  </radialGradient>
                  <radialGradient id="globe-city-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="100" cy="100" r="86" fill="url(#globe-sphere)" stroke="rgba(255,255,255,0.08)" />
                {[60, 30, 0, -30, -60].map((lat) => {
                  const r = 84 * Math.cos((lat * Math.PI) / 180);
                  const y = 100 - 84 * Math.sin((lat * Math.PI) / 180);
                  return <ellipse key={lat} cx="100" cy={y} rx={r} ry={r * 0.14} fill="none" stroke="rgba(255,255,255,0.06)" />;
                })}
                {meridians.map((rx, i) => (
                  <ellipse key={i} cx="100" cy="100" rx={rx} ry="84" fill="none" stroke="rgba(255,255,255,0.06)" />
                ))}
                <circle cx="100" cy="100" r="86" fill="none" stroke="rgba(255,255,255,0.12)" />
                {globeCities
                  .filter((c) => c.z > -0.12)
                  .sort((a, b) => a.z - b.z)
                  .map((c) => {
                    const depth = Math.max(0.25, (c.z + 0.12) / 1.12);
                    const r = (3 + c.weight * 4) * (0.6 + depth * 0.5);
                    return (
                      <g key={c.name} opacity={Math.min(1, depth + 0.15)}>
                        <circle cx={c.x} cy={c.y} r={r * 2.4} fill="url(#globe-city-glow)" />
                        <circle cx={c.x} cy={c.y} r={r} fill="#22d3ee" />
                      </g>
                    );
                  })}
              </svg>
            </motion.div>
          ) : (
            <motion.div
              key="flat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="relative px-4 py-10 sm:py-14"
            >
              <svg viewBox="0 0 100 50" className="mx-auto w-full max-w-3xl">
                {dots.map((d, i) => (
                  <circle key={i} cx={d.x} cy={d.y} r={0.35} fill="rgba(255,255,255,0.16)" />
                ))}
                {CITIES.map((c) => {
                  const { x, y } = lonLatToPct(c.lon, c.lat);
                  const r = 0.8 + c.weight * 1.3;
                  return (
                    <g
                      key={c.name}
                      onMouseEnter={() => setHover(c.name)}
                      onMouseLeave={() => setHover(null)}
                      className="cursor-pointer"
                    >
                      <circle cx={x} cy={y} r={r * 2.2} fill="url(#globe-city-glow)" opacity={0.7} />
                      <circle cx={x} cy={y} r={r} fill="#22d3ee" />
                    </g>
                  );
                })}
                <defs>
                  <radialGradient id="globe-city-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
                  </radialGradient>
                </defs>
              </svg>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-surface-dark-border px-6 py-4 text-xs text-surface-dark-ink-soft">
          {CITIES.slice(0, 6).map((c) => (
            <span
              key={c.name}
              className={`transition-colors duration-200 ${hover === c.name ? "text-accent-cyan" : ""}`}
            >
              {c.name} <span className="text-surface-dark-ink-soft/60">· {c.share}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
