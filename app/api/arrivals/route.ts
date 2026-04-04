import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

const AVINOR_URL = "https://asrv.avinor.no/XmlFeed/v1.0";
const OSLO_TZ = "Europe/Oslo";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function parseUtc(v: string | undefined): Date | null {
  if (!v) return null;
  return new Date(v.endsWith("Z") ? v : v + "Z");
}

function fmtOslo(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleTimeString("no-NO", {
    timeZone: OSLO_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

async function fetchAvinorXml(params: Record<string, string>) {
  const url = new URL(AVINOR_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) throw new Error(`Avinor svarte ${res.status}`);
  return parser.parse(await res.text());
}

export interface SasArrival {
  flightNumber: string;
  scheduledArrival: string;   // HH:mm
  actualArrival: string | null;
  cancelled: boolean;
  delayed: boolean;
  delayMinutes: number | null;
  gate: string | null;
  landed: boolean;             // true = already on the ground
  minutesAgo: number | null;   // minutes since landing (if landed)
  minutesUntil: number | null; // minutes until scheduled arrival (if not landed)
}

export async function GET() {
  const now = new Date();
  // Include flights that landed up to 75 min ago (passengers still arriving at bus stop)
  const recentCutoff = new Date(now.getTime() - 75 * 60 * 1000);

  try {
    const data = await fetchAvinorXml({
      airport: "OSL",
      TimeFrom: "0",
      TimeTo: "5",
      direction: "A",
    });

    const arrivals: SasArrival[] = [];

    for (const f of toArray(data?.airport?.flights?.flight)) {
      if (f?.airport !== "BGO") continue;
      if (f?.airline !== "SK") continue;

      const schedDt = parseUtc(String(f?.schedule_time ?? ""));
      if (!schedDt) continue;
      if (schedDt < recentCutoff) continue;

      const statusCode = String(f?.status?.["@_code"] ?? "");
      const statusDt   = parseUtc(String(f?.status?.["@_time"] ?? ""));

      const delayMin =
        schedDt && statusDt
          ? Math.round((statusDt.getTime() - schedDt.getTime()) / 60000)
          : null;

      const landed    = statusCode === "A"; // "A" = arrived/landed in Avinor
      const actualDt  = statusDt && statusDt.getTime() !== schedDt.getTime() ? statusDt : null;
      const effectiveDt = actualDt ?? schedDt;

      arrivals.push({
        flightNumber:    String(f?.flight_id ?? "-"),
        scheduledArrival: fmtOslo(schedDt),
        actualArrival:   actualDt ? fmtOslo(actualDt) : null,
        cancelled:       statusCode === "C",
        delayed:         f?.delayed === "Y" || (delayMin !== null && delayMin > 0),
        delayMinutes:    delayMin && delayMin > 0 ? delayMin : null,
        gate:            f?.gate ? String(f.gate) : null,
        landed,
        minutesAgo:    landed  ? Math.round((now.getTime() - effectiveDt.getTime()) / 60000) : null,
        minutesUntil:  !landed ? Math.round((effectiveDt.getTime() - now.getTime()) / 60000) : null,
      });
    }

    arrivals.sort((a, b) => a.scheduledArrival.localeCompare(b.scheduledArrival));

    return NextResponse.json({
      arrivals,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ukjent feil" },
      { status: 500 }
    );
  }
}
