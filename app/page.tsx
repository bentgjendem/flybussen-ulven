"use client";

import { useState, useEffect, useCallback } from "react";
import type { Departure } from "./api/departures/route";
import type { MetroFlyJourney } from "./api/metro-fly/route";
import type { SasFlight } from "./api/flights/route";

// ── Stop definitions ─────────────────────────────────────────
const ULVEN_TORG   = { id: "NSR:StopPlace:5920",  code: "ULV", name: "Ulven Torg",   icon: "🏙️" };
const ULVENKRYSSET = { id: "NSR:StopPlace:5919",  code: "ULV", name: "Ulvenkrysset", icon: "🏙️" };
const OSL          = { id: "NSR:StopPlace:58211", code: "OSL", name: "Oslo Lufthavn", icon: "✈️" };

type Direction = "ulven-osl" | "osl-ulven";

const FETCH_NUM      = 8;
const SHOW_PER_STOP  = 2;
const SHOW_TRANSIT   = 2;
const REFRESH_INTERVAL = 60;

// ── Helpers ──────────────────────────────────────────────────
function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("no-NO", {
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo",
  });
}

function fmtDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}t ${m} min` : `${m} min`;
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

async function fetchTransit(direction: Direction): Promise<MetroFlyJourney[]> {
  const res = await fetch(`/api/metro-fly?direction=${direction}&num=${SHOW_TRANSIT}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return (data.journeys ?? []) as MetroFlyJourney[];
}

async function fetchFlights(oslArrivalIso: string): Promise<{ flights: SasFlight[]; minDeparture: string; oslArrival: string }> {
  const res = await fetch(`/api/flights?after=${encodeURIComponent(oslArrivalIso)}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

/** Returns the ISO string of the earliest OSL arrival across all shown transport options. */
function earliestOslArrival(
  groupA: GroupState,
  groupB: GroupState | null,
  transit: TransitState,
): string | null {
  const candidates: number[] = [];
  if (groupA.departures[0]) candidates.push(new Date(groupA.departures[0].expectedArrival).getTime());
  if (groupB?.departures[0]) candidates.push(new Date(groupB.departures[0].expectedArrival).getTime());
  if (transit.journeys[0]) candidates.push(new Date(transit.journeys[0].expectedArrival).getTime());
  if (!candidates.length) return null;
  return new Date(Math.min(...candidates)).toISOString();
}

// ── Sub-components ────────────────────────────────────────────

function BusRouteHeader({ direction, onSwap }: { direction: Direction; onSwap: () => void }) {
  const from = direction === "ulven-osl" ? ULVEN_TORG : OSL;
  const to   = direction === "ulven-osl" ? OSL : ULVEN_TORG;
  return (
    <div className="route-header" onClick={onSwap} title="Klikk for å bytte retning">
      <div className="stop">
        <div className="stop-code">{from.code}</div>
        <div className="stop-name">{from.name}</div>
      </div>
      <div className="route-middle">
        <svg className="route-svg" viewBox="0 0 260 40" preserveAspectRatio="none">
          {/* Road surface */}
          <rect x="0" y="28" width="260" height="8" rx="2" fill="rgba(255,255,255,0.12)" />
          {/* Dashed centre line */}
          <line x1="0" y1="32" x2="260" y2="32"
            stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeDasharray="12 8" />
          {/* Bus rolling along the road */}
          <text fontSize="24" textAnchor="middle" fill="white"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,80,0.4))" }}>
            🚌
            <animateMotion dur="5s" repeatCount="indefinite" path="M 0 24 L 244 24" />
          </text>
        </svg>
        <div className="route-label">Flybussen</div>
        <div className="swap-hint">↕ klikk for å bytte retning</div>
      </div>
      <div className="stop">
        <div className="stop-code">{to.code}</div>
        <div className="stop-name">{to.name}</div>
      </div>
    </div>
  );
}

function DepartureCard({ dep }: { dep: Departure }) {
  const minsUntil  = minutesUntil(dep.expectedDeparture);
  const isDelayed  = dep.delayMinutes >= 2;
  const isDeparted = minsUntil < -1;
  return (
    <div className={`dep-card${isDeparted ? " departed" : ""}`}>
      <div className="dep-times">
        <div className="dep-time-block">
          {isDelayed && <div className="dep-time delayed">{fmt(dep.aimedDeparture)}</div>}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>{fmt(dep.expectedDeparture)}</div>
          <div className="dep-time-label">Avgang</div>
        </div>
        <div className="dep-arrow">
          <div className="dep-duration">{fmtDuration(dep.duration)}</div>
          <div className="dep-arrow-line"><hr /><span className="dep-arrow-tip">▶</span></div>
        </div>
        <div className="dep-time-block">
          {isDelayed && <div className="dep-time delayed">{fmt(dep.aimedArrival)}</div>}
          <div className={`dep-time${isDelayed ? " expected" : ""}`}>{fmt(dep.expectedArrival)}</div>
          <div className="dep-time-label">Ankomst</div>
        </div>
      </div>
      <div className="dep-meta">
        <span className="dep-line">{dep.lineCode}</span>
        {dep.fromQuay && <span className="dep-quay">🚏 Platform {dep.fromQuay}</span>}
        {isDelayed ? (
          <span className="dep-status delayed">+{dep.delayMinutes} min</span>
        ) : dep.realtime ? (
          <span className="dep-status on-time">I rute</span>
        ) : (
          <span className="dep-status" style={{ color: "#6b7280", background: "#f3f4f6", border: "1px solid #e5e7eb" }}>Rutetid</span>
        )}
      </div>
      {!isDeparted && (
        <div className={`dep-countdown${minsUntil <= 5 ? " soon" : ""}`}>
          {minsUntil <= 0 ? "Avgår nå" : minsUntil === 1 ? "Om 1 minutt" : `Om ${minsUntil} minutter`}
        </div>
      )}
    </div>
  );
}

function StopGroup({ stopName, departures, loading, error }: {
  stopName: string; departures: Departure[]; loading: boolean; error: string | null;
}) {
  return (
    <div className="stop-group">
      <div className="stop-group-header">
        <span className="stop-group-pin">📍</span>
        <span className="stop-group-name">{stopName}</span>
      </div>
      {loading && departures.length === 0 && (
        <div className="state-msg compact"><span className="state-msg-icon">🚌</span> Henter…</div>
      )}
      {error && (
        <div className="state-msg compact error"><span className="state-msg-icon">⚠️</span> {error}</div>
      )}
      {!loading && !error && departures.length === 0 && (
        <div className="state-msg compact"><span className="state-msg-icon">🔍</span> Ingen avganger funnet</div>
      )}
      {departures.slice(0, SHOW_PER_STOP).map((dep, i) => (
        <DepartureCard key={i} dep={dep} />
      ))}
    </div>
  );
}

function modeIcon(mode: string) {
  if (mode === "metro") return "🚇";
  if (mode === "rail")  return "🚄";
  return "🚌";
}

function TransitCard({ journey }: { journey: MetroFlyJourney }) {
  const { firstLeg, secondLeg, transferMinutes, totalDurationSeconds } = journey;
  const minsUntil  = minutesUntil(firstLeg.expectedDeparture);
  const isDeparted = minsUntil < -1;
  const isFirstDelayed  = firstLeg.delayMinutes >= 2;
  const isSecondDelayed = secondLeg.delayMinutes >= 2;

  return (
    <div className={`transit-card${isDeparted ? " departed" : ""}`}>
      {/* Summary: total departure → arrival */}
      <div className="transit-summary">
        <div className="transit-time-block">
          <div className="transit-time">{fmt(firstLeg.expectedDeparture)}</div>
          <div className="transit-time-label">Avgang</div>
        </div>
        <div className="transit-arrow">
          <div className="transit-duration">{fmtDuration(totalDurationSeconds)}</div>
          <div className="transit-arrow-line"><hr /><span className="transit-arrow-tip">▶</span></div>
        </div>
        <div className="transit-time-block">
          <div className="transit-time">{fmt(secondLeg.expectedArrival)}</div>
          <div className="transit-time-label">Ankomst</div>
        </div>
      </div>

      {/* Legs breakdown */}
      <div className="transit-legs">
        {/* First leg */}
        <div className="transit-leg-row">
          <span className="transit-leg-icon">{modeIcon(firstLeg.mode)}</span>
          <span className="transit-leg-line">{firstLeg.lineCode}</span>
          <span className="transit-leg-times">{fmt(firstLeg.expectedDeparture)}–{fmt(firstLeg.expectedArrival)}</span>
          <span className="transit-leg-route">{firstLeg.toPlace}</span>
          {isFirstDelayed && <span className="transit-leg-delayed">+{firstLeg.delayMinutes} min</span>}
        </div>

        {/* Transfer */}
        <div className="transit-transfer-row">
          <span className="transit-leg-icon">🚶</span>
          <span>~{transferMinutes} min · Oslo S</span>
        </div>

        {/* Second leg */}
        <div className="transit-leg-row">
          <span className="transit-leg-icon">{modeIcon(secondLeg.mode)}</span>
          <span className="transit-leg-line">{secondLeg.lineCode}</span>
          <span className="transit-leg-times">{fmt(secondLeg.expectedDeparture)}–{fmt(secondLeg.expectedArrival)}</span>
          <span className="transit-leg-route">{secondLeg.toPlace}</span>
          {isSecondDelayed && <span className="transit-leg-delayed">+{secondLeg.delayMinutes} min</span>}
        </div>
      </div>

      {/* Meta */}
      <div className="transit-meta">
        <span className={`dep-countdown${minsUntil <= 5 && !isDeparted ? " soon" : ""}`}>
          {isDeparted ? "" : minsUntil <= 0 ? "Avgår nå" : minsUntil === 1 ? "Om 1 minutt" : `Om ${minsUntil} minutter`}
        </span>
        {(firstLeg.realtime || secondLeg.realtime) && (
          <span className="dep-status on-time">
            {isFirstDelayed || isSecondDelayed ? "Forsinket" : "I rute"}
          </span>
        )}
      </div>
    </div>
  );
}

function FlightCard({ flight }: { flight: SasFlight }) {
  const isDelayed   = flight.delayed && !flight.cancelled;
  const isCancelled = flight.cancelled;
  return (
    <div className={`flight-card${isCancelled ? " cancelled" : ""}`}>
      <div className="flight-times">
        {/* Departure */}
        <div>
          {isDelayed && <div className="flight-time cancelled-time">{flight.scheduledDeparture}</div>}
          <div className={`flight-time${isDelayed ? " actual" : ""}`}>
            {flight.actualDeparture ?? flight.scheduledDeparture}
          </div>
        </div>
        <div className="flight-route">
          <hr />✈<hr />
        </div>
        {/* Arrival BGO */}
        <div className="flight-time">{flight.scheduledArrivalBgo}</div>
      </div>

      <div className="flight-meta">
        <span className="flight-number">{flight.flightNumber}</span>
        <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>OSL → BGO</span>
        {flight.gate && <span className="flight-gate">Gate {flight.gate}</span>}
        {isCancelled ? (
          <span className="dep-status delayed">Kansellert</span>
        ) : isDelayed ? (
          <span className="dep-status delayed">+{flight.delayMinutes} min</span>
        ) : (
          <span className="dep-status on-time">I rute</span>
        )}
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={spinning ? { animation: "spin 1s linear infinite" } : {}}>
      <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ── State types ───────────────────────────────────────────────
type GroupState   = { departures: Departure[];      loading: boolean; error: string | null };
type TransitState = { journeys: MetroFlyJourney[];  loading: boolean; error: string | null };
type FlightsState = { flights: SasFlight[]; minDeparture: string | null; oslArrival: string | null; loading: boolean; error: string | null };

const emptyGroup   = (): GroupState   => ({ departures: [], loading: true,  error: null });
const emptyTransit = (): TransitState => ({ journeys:   [], loading: true,  error: null });
const emptyFlights = (): FlightsState => ({ flights: [],   minDeparture: null, oslArrival: null, loading: true, error: null });

// ── Main page ─────────────────────────────────────────────────
export default function Home() {
  const [direction, setDirection] = useState<Direction>("ulven-osl");
  const [groupA,    setGroupA]    = useState<GroupState>(emptyGroup());
  const [groupB,    setGroupB]    = useState<GroupState | null>(null);
  const [transit,   setTransit]   = useState<TransitState>(emptyTransit());
  const [flights,   setFlights]   = useState<FlightsState>(emptyFlights());
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);

  const isLoading = groupA.loading || (groupB?.loading ?? false) || transit.loading;

  const fetchAll = useCallback(async () => {
    if (direction === "ulven-osl") {
      setGroupA(emptyGroup());
      setGroupB(emptyGroup());
    } else {
      setGroupA(emptyGroup());
      setGroupB(null);
    }
    setTransit(emptyTransit());

    const now = new Date().toISOString();

    if (direction === "ulven-osl") {
      setFlights(emptyFlights());
      const [resA, resB, resT] = await Promise.allSettled([
        fetchGroup(ULVEN_TORG.id, OSL.id),
        fetchGroup(ULVENKRYSSET.id, OSL.id),
        fetchTransit("ulven-osl"),
      ]);
      const newA: GroupState = { departures: resA.status === "fulfilled" ? resA.value : [], loading: false,
        error: resA.status === "rejected" ? String(resA.reason) : null };
      const newB: GroupState = { departures: resB.status === "fulfilled" ? resB.value : [], loading: false,
        error: resB.status === "rejected" ? String(resB.reason) : null };
      const newT: TransitState = { journeys: resT.status === "fulfilled" ? resT.value : [], loading: false,
        error: resT.status === "rejected" ? String(resT.reason) : null };
      setGroupA(newA); setGroupB(newB); setTransit(newT);

      // Fetch SAS flights based on earliest OSL arrival
      const earliest = earliestOslArrival(newA, newB, newT);
      if (earliest) {
        fetchFlights(earliest)
          .then(d => setFlights({ flights: d.flights, minDeparture: d.minDeparture, oslArrival: d.oslArrival, loading: false, error: null }))
          .catch(e => setFlights({ flights: [], minDeparture: null, oslArrival: null, loading: false, error: String(e) }));
      } else {
        setFlights({ flights: [], minDeparture: null, oslArrival: null, loading: false, error: null });
      }
    } else {
      setFlights({ ...emptyFlights(), loading: false }); // no flights section in return direction
      const [resA, resT] = await Promise.allSettled([
        fetchGroup(OSL.id, ULVEN_TORG.id),
        fetchTransit("osl-ulven"),
      ]);
      setGroupA({ departures: resA.status === "fulfilled" ? resA.value : [], loading: false,
        error: resA.status === "rejected" ? String(resA.reason) : null });
      setTransit({ journeys: resT.status === "fulfilled" ? resT.value : [], loading: false,
        error: resT.status === "rejected" ? String(resT.reason) : null });
    }

    void now;
    setFetchedAt(new Date().toISOString());
    setCountdown(REFRESH_INTERVAL);
  }, [direction]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const iv = setInterval(() => {
      setCountdown((c) => { if (c <= 1) { fetchAll(); return REFRESH_INTERVAL; } return c - 1; });
    }, 1000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const transitTitle = direction === "ulven-osl"
    ? "🚇 T-bane (Økern) + 🚄 Flytoget"
    : "🚄 Flytoget + 🚇 T-bane (Jernbanetorget)";

  const busTitle = direction === "ulven-osl"
    ? "🚌 Flybussen mot Oslo Lufthavn"
    : `🚌 Flybussen fra ${OSL.name}`;

  return (
    <div className="card">
      <BusRouteHeader
        direction={direction}
        onSwap={() => setDirection((d) => (d === "ulven-osl" ? "osl-ulven" : "ulven-osl"))}
      />

      <div className="card-header">
        <div className="card-header-left">
          <h1>{busTitle}</h1>
        </div>
        <button className={`refresh-btn${isLoading ? " spinning" : ""}`}
          onClick={fetchAll} disabled={isLoading} title="Oppdater">
          <RefreshIcon spinning={isLoading} />
          {isLoading ? "Laster…" : `${countdown}s`}
        </button>
      </div>

      <div className="departures">
        {/* ── Flybussen groups ── */}
        <StopGroup
          stopName={direction === "ulven-osl" ? ULVEN_TORG.name : OSL.name}
          departures={groupA.departures}
          loading={groupA.loading}
          error={groupA.error}
        />
        {groupB && (
          <StopGroup
            stopName={ULVENKRYSSET.name}
            departures={groupB.departures}
            loading={groupB.loading}
            error={groupB.error}
          />
        )}

        {/* ── T-bane + Flytoget section ── */}
        <div className="transit-section">
          <div className="transit-section-header">
            <span className="transit-section-title">{transitTitle}</span>
          </div>

          {transit.loading && transit.journeys.length === 0 && (
            <div className="state-msg compact">
              <span className="state-msg-icon">🚇</span> Henter…
            </div>
          )}
          {transit.error && (
            <div className="state-msg compact error">
              <span className="state-msg-icon">⚠️</span> {transit.error}
            </div>
          )}
          {!transit.loading && !transit.error && transit.journeys.length === 0 && (
            <div className="state-msg compact">
              <span className="state-msg-icon">🔍</span> Ingen reiser funnet
            </div>
          )}
          {transit.journeys.map((j, i) => (
            <TransitCard key={i} journey={j} />
          ))}
        </div>

        {/* ── SAS Oslo → Bergen flights ── */}
        {direction === "ulven-osl" && (
          <div className="flight-section">
            <div className="flight-section-header">
              <span className="flight-section-title">✈ SAS Oslo → Bergen</span>
              {flights.oslArrival && flights.minDeparture && (
                <span className="flight-section-subtitle">
                  tidligst OSL {flights.oslArrival} · viser avgang etter {flights.minDeparture}
                </span>
              )}
            </div>
            {flights.loading && (
              <div className="state-msg compact"><span className="state-msg-icon">✈</span> Henter flydata…</div>
            )}
            {flights.error && (
              <div className="state-msg compact error"><span className="state-msg-icon">⚠️</span> {flights.error}</div>
            )}
            {!flights.loading && !flights.error && flights.flights.length === 0 && (
              <div className="state-msg compact"><span className="state-msg-icon">🔍</span> Ingen SAS-avganger funnet</div>
            )}
            {flights.flights.map((f, i) => <FlightCard key={i} flight={f} />)}
          </div>
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
