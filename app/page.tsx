"use client";

import { useState, useEffect, useCallback } from "react";
import type { Departure } from "./api/departures/route";

const STOPS = {
  ulven: { id: "NSR:StopPlace:5920", code: "ULV", name: "Ulven Torg", icon: "🏙️" },
  osl: { id: "NSR:StopPlace:58211", code: "OSL", name: "Oslo Lufthavn", icon: "✈️" },
} as const;

type Direction = "ulven-osl" | "osl-ulven";

const REFRESH_INTERVAL = 60; // seconds

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Oslo",
  });
}

function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}t ${m}min`;
  return `${m} min`;
}

function minutesUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function BusRouteHeader({
  direction,
  onSwap,
}: {
  direction: Direction;
  onSwap: () => void;
}) {
  const from = direction === "ulven-osl" ? STOPS.ulven : STOPS.osl;
  const to = direction === "ulven-osl" ? STOPS.osl : STOPS.ulven;

  return (
    <div className="route-header" onClick={onSwap} title="Klikk for å bytte retning">
      <div className="stop">
        <div className="stop-icon">{from.icon}</div>
        <div className="stop-code">{from.code}</div>
        <div className="stop-name">{from.name}</div>
      </div>

      <div className="route-middle">
        <svg className="route-svg" viewBox="0 0 260 56" preserveAspectRatio="none">
          <path
            d="M 16 44 Q 130 -4 244 44"
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            strokeWidth="1.5"
            strokeDasharray="6 5"
          />
          {/* Bus icon animated along the path */}
          <text fontSize="20" textAnchor="middle" fill="white" style={{ filter: "drop-shadow(0 0 5px rgba(100,180,255,0.8))" }}>
            🚌
            <animateMotion
              dur="6s"
              repeatCount="indefinite"
              path="M 16 44 Q 130 -4 244 44"
              rotate="auto"
            />
          </text>
        </svg>
        <div className="route-label">Flybussen</div>
        <div className="swap-hint">↕ klikk for å bytte retning</div>
      </div>

      <div className="stop">
        <div className="stop-icon">{to.icon}</div>
        <div className="stop-code">{to.code}</div>
        <div className="stop-name">{to.name}</div>
      </div>
    </div>
  );
}

function DepartureCard({ dep }: { dep: Departure }) {
  const minsUntil = minutesUntil(dep.expectedDeparture);
  const isDelayed = dep.delayMinutes >= 2;
  const isDeparted = minsUntil < -1;

  return (
    <div className={`dep-card${isDeparted ? " departed" : ""}`}>
      {/* Times row */}
      <div className="dep-times">
        {/* Departure */}
        <div className="dep-time-block">
          {isDelayed && (
            <div className="dep-time delayed">{fmt(dep.aimedDeparture)}</div>
          )}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>
            {fmt(dep.expectedDeparture)}
          </div>
          <div className="dep-time-label">Avgang</div>
        </div>

        {/* Arrow with duration */}
        <div className="dep-arrow">
          <div className="dep-duration">{fmtDuration(dep.duration)}</div>
          <div className="dep-arrow-line">
            <hr />
            <span className="dep-arrow-tip">▶</span>
          </div>
        </div>

        {/* Arrival */}
        <div className="dep-time-block">
          {isDelayed && (
            <div className="dep-time delayed">{fmt(dep.aimedArrival)}</div>
          )}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>
            {fmt(dep.expectedArrival)}
          </div>
          <div className="dep-time-label">Ankomst</div>
        </div>
      </div>

      {/* Meta row */}
      <div className="dep-meta">
        <span className="dep-line">{dep.lineCode}</span>

        {dep.fromQuay && (
          <span className="dep-quay">
            🚏 Platform {dep.fromQuay}
          </span>
        )}

        {isDelayed ? (
          <span className="dep-status delayed">+{dep.delayMinutes} min</span>
        ) : dep.realtime ? (
          <span className="dep-status on-time">I rute</span>
        ) : (
          <span className="dep-status" style={{ color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb" }}>
            Rutetid
          </span>
        )}
      </div>

      {/* Countdown */}
      {!isDeparted && (
        <div className={`dep-countdown${minsUntil <= 5 ? " soon" : ""}`}>
          {minsUntil <= 0
            ? "Avgår nå"
            : minsUntil === 1
            ? "Om 1 minutt"
            : `Om ${minsUntil} minutter`}
        </div>
      )}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={spinning ? { animation: "spin 1s linear infinite" } : {}}
    >
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export default function Home() {
  const [direction, setDirection] = useState<Direction>("ulven-osl");
  const [departures, setDepartures] = useState<Departure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

  const from = direction === "ulven-osl" ? STOPS.ulven.id : STOPS.osl.id;
  const to = direction === "ulven-osl" ? STOPS.osl.id : STOPS.ulven.id;

  const fetchDepartures = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/departures?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDepartures(data.departures ?? []);
      setFetchedAt(data.fetchedAt ?? null);
      setCountdown(REFRESH_INTERVAL);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Klarte ikke hente avganger");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // Initial fetch + re-fetch when direction changes
  useEffect(() => {
    fetchDepartures();
  }, [fetchDepartures]);

  // Auto-refresh countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          fetchDepartures();
          return REFRESH_INTERVAL;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchDepartures]);

  // Re-render every 30s so countdowns stay fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const fromStop = direction === "ulven-osl" ? STOPS.ulven : STOPS.osl;

  return (
    <div className="card">
      <BusRouteHeader
        direction={direction}
        onSwap={() => setDirection((d) => (d === "ulven-osl" ? "osl-ulven" : "ulven-osl"))}
      />

      <div className="card-header">
        <div className="card-header-left">
          <h1>🚌 Avganger fra {fromStop.name}</h1>
        </div>
        <button
          className={`refresh-btn${loading ? " spinning" : ""}`}
          onClick={fetchDepartures}
          disabled={loading}
          title="Oppdater"
        >
          <RefreshIcon spinning={loading} />
          {loading ? "Laster…" : `${countdown}s`}
        </button>
      </div>

      <div className="departures">
        {loading && departures.length === 0 && (
          <div className="state-msg">
            <div className="icon">🚌</div>
            <div>Henter avganger…</div>
          </div>
        )}

        {error && (
          <div className="state-msg error">
            <div className="icon">⚠️</div>
            <div>{error}</div>
            <button className="refresh-btn" onClick={fetchDepartures} style={{ marginTop: "0.5rem" }}>
              Prøv igjen
            </button>
          </div>
        )}

        {!loading && !error && departures.length === 0 && (
          <div className="state-msg">
            <div className="icon">🔍</div>
            <div>Ingen avganger funnet.</div>
          </div>
        )}

        {departures.map((dep, i) => (
          <DepartureCard key={i} dep={dep} />
        ))}
      </div>

      <div className="card-footer">
        <span className="footer-text">
          {fetchedAt
            ? `Oppdatert ${new Date(fetchedAt).toLocaleTimeString("no-NO", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Oslo" })}`
            : "Kilde: Entur"}
        </span>
        <span className="footer-live">
          <span className="live-dot" />
          Entur sanntid
        </span>
      </div>
    </div>
  );
}
