"use client";

import { useState, useEffect, useCallback } from "react";
import type { Departure } from "./api/departures/route";

// ── Stop definitions ────────────────────────────────────────
const ULVEN_TORG     = { id: "NSR:StopPlace:5920",  code: "ULV", name: "Ulven Torg",   icon: "🏙️" };
const ULVENKRYSSET   = { id: "NSR:StopPlace:5919",  code: "ULV", name: "Ulvenkrysset", icon: "🏙️" };
const OSL            = { id: "NSR:StopPlace:58211", code: "OSL", name: "Oslo Lufthavn", icon: "✈️" };

type Direction = "ulven-osl" | "osl-ulven";

// How many trip patterns to request per stop (fetch more than we show to survive filtering)
const FETCH_NUM = 8;
// How many departures to show per stop group
const SHOW_PER_STOP = 2;
const REFRESH_INTERVAL = 60; // seconds

// ── Helpers ──────────────────────────────────────────────────
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
  if (h > 0) return `${h}t ${m} min`;
  return `${m} min`;
}

function minutesUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

async function fetchGroup(fromId: string, toId: string): Promise<Departure[]> {
  const url = `/api/departures?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&num=${FETCH_NUM}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.departures ?? []) as Departure[];
}

// ── Sub-components ────────────────────────────────────────────

function BusRouteHeader({ direction, onSwap }: { direction: Direction; onSwap: () => void }) {
  const from = direction === "ulven-osl" ? ULVEN_TORG : OSL;
  const to   = direction === "ulven-osl" ? OSL : ULVEN_TORG;

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
          <text fontSize="20" textAnchor="middle" fill="white"
            style={{ filter: "drop-shadow(0 0 5px rgba(100,180,255,0.8))" }}>
            🚌
            <animateMotion dur="6s" repeatCount="indefinite"
              path="M 16 44 Q 130 -4 244 44" rotate="auto" />
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
  const isDelayed  = dep.delayMinutes >= 2;
  const isDeparted = minsUntil < -1;

  return (
    <div className={`dep-card${isDeparted ? " departed" : ""}`}>
      {/* Times */}
      <div className="dep-times">
        <div className="dep-time-block">
          {isDelayed && <div className="dep-time delayed">{fmt(dep.aimedDeparture)}</div>}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>{fmt(dep.expectedDeparture)}</div>
          <div className="dep-time-label">Avgang</div>
        </div>

        <div className="dep-arrow">
          <div className="dep-duration">{fmtDuration(dep.duration)}</div>
          <div className="dep-arrow-line">
            <hr />
            <span className="dep-arrow-tip">▶</span>
          </div>
        </div>

        <div className="dep-time-block">
          {isDelayed && <div className="dep-time delayed">{fmt(dep.aimedArrival)}</div>}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>{fmt(dep.expectedArrival)}</div>
          <div className="dep-time-label">Ankomst</div>
        </div>
      </div>

      {/* Meta */}
      <div className="dep-meta">
        <span className="dep-line">{dep.lineCode}</span>

        {dep.fromQuay && (
          <span className="dep-quay">🚏 Platform {dep.fromQuay}</span>
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
          {minsUntil <= 0 ? "Avgår nå" : minsUntil === 1 ? "Om 1 minutt" : `Om ${minsUntil} minutter`}
        </div>
      )}
    </div>
  );
}

function StopGroup({
  stopName,
  departures,
  loading,
  error,
}: {
  stopName: string;
  departures: Departure[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="stop-group">
      <div className="stop-group-header">
        <span className="stop-group-pin">📍</span>
        <span className="stop-group-name">{stopName}</span>
      </div>

      {loading && departures.length === 0 && (
        <div className="state-msg compact">
          <span className="state-msg-icon">🚌</span> Henter…
        </div>
      )}

      {error && (
        <div className="state-msg compact error">
          <span className="state-msg-icon">⚠️</span> {error}
        </div>
      )}

      {!loading && !error && departures.length === 0 && (
        <div className="state-msg compact">
          <span className="state-msg-icon">🔍</span> Ingen avganger funnet
        </div>
      )}

      {departures.slice(0, SHOW_PER_STOP).map((dep, i) => (
        <DepartureCard key={i} dep={dep} />
      ))}
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: "spin 1s linear infinite" } : {}}>
      <path d="M23 4v6h-6" />
      <path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ── Main page ────────────────────────────────────────────────
type GroupState = { departures: Departure[]; loading: boolean; error: string | null };

const emptyGroup = (): GroupState => ({ departures: [], loading: true, error: null });

export default function Home() {
  const [direction, setDirection]     = useState<Direction>("ulven-osl");
  const [groupA, setGroupA]           = useState<GroupState>(emptyGroup());   // Ulven Torg  / OSL
  const [groupB, setGroupB]           = useState<GroupState | null>(null);    // Ulvenkrysset (ulven-osl only)
  const [fetchedAt, setFetchedAt]     = useState<string | null>(null);
  const [countdown, setCountdown]     = useState(REFRESH_INTERVAL);

  const isLoading = groupA.loading || (groupB?.loading ?? false);

  const fetchAll = useCallback(async () => {
    if (direction === "ulven-osl") {
      // Two parallel fetches — one per Ulven stop
      setGroupA(emptyGroup());
      setGroupB(emptyGroup());

      const [resA, resB] = await Promise.allSettled([
        fetchGroup(ULVEN_TORG.id, OSL.id),
        fetchGroup(ULVENKRYSSET.id, OSL.id),
      ]);

      setGroupA({
        departures: resA.status === "fulfilled" ? resA.value : [],
        loading:    false,
        error:      resA.status === "rejected" ? String(resA.reason) : null,
      });
      setGroupB({
        departures: resB.status === "fulfilled" ? resB.value : [],
        loading:    false,
        error:      resB.status === "rejected" ? String(resB.reason) : null,
      });
    } else {
      // Single fetch from OSL → Ulven Torg
      setGroupA(emptyGroup());
      setGroupB(null);
      try {
        const deps = await fetchGroup(OSL.id, ULVEN_TORG.id);
        setGroupA({ departures: deps, loading: false, error: null });
      } catch (e) {
        setGroupA({ departures: [], loading: false, error: String(e) });
      }
    }

    setFetchedAt(new Date().toISOString());
    setCountdown(REFRESH_INTERVAL);
  }, [direction]);

  // Fetch on mount + direction change
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh countdown
  useEffect(() => {
    const iv = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { fetchAll(); return REFRESH_INTERVAL; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  // Tick every 30 s to keep countdown labels fresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const headerTitle =
    direction === "ulven-osl"
      ? "🚌 Avganger mot Oslo Lufthavn"
      : `🚌 Avganger fra ${OSL.name}`;

  return (
    <div className="card">
      <BusRouteHeader
        direction={direction}
        onSwap={() => setDirection((d) => (d === "ulven-osl" ? "osl-ulven" : "ulven-osl"))}
      />

      <div className="card-header">
        <div className="card-header-left">
          <h1>{headerTitle}</h1>
        </div>
        <button
          className={`refresh-btn${isLoading ? " spinning" : ""}`}
          onClick={fetchAll}
          disabled={isLoading}
          title="Oppdater"
        >
          <RefreshIcon spinning={isLoading} />
          {isLoading ? "Laster…" : `${countdown}s`}
        </button>
      </div>

      <div className="departures">
        {/* Ulven Torg group (or OSL group in reverse) */}
        <StopGroup
          stopName={direction === "ulven-osl" ? ULVEN_TORG.name : OSL.name}
          departures={groupA.departures}
          loading={groupA.loading}
          error={groupA.error}
        />

        {/* Ulvenkrysset group — only shown going toward OSL */}
        {groupB && (
          <StopGroup
            stopName={ULVENKRYSSET.name}
            departures={groupB.departures}
            loading={groupB.loading}
            error={groupB.error}
          />
        )}
      </div>

      <div className="card-footer">
        <span className="footer-text">
          {fetchedAt
            ? `Oppdatert ${new Date(fetchedAt).toLocaleTimeString("no-NO", {
                hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Oslo",
              })}`
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
