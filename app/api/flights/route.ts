import { NextRequest, NextResponse } from "next/server";
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
  return d.toLocaleTimeString("no-NO", { timeZone: OSLO_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
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

export interface SasFlight {
  flightNumber: string;
  scheduledDeparture: string; // HH:mm
  actualDeparture: string | null;
  scheduledArrivalBgo: string;
  cancelled: boolean;
  delayed: boolean;
  delayMinutes: number | null;
  gate: string | null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // "after" = ISO time of OSL arrival. We add 30 min to get earliest acceptable departure.
  const afterParam = searchParams.get("after");
  const oslArrival = afterParam ? new Date(afterParam) : new Date();
  const minDeparture = new Date(oslArrival.getTime() + 30 * 60 * 1000);

  try {
    const [depData, bgoData] = await Promise.all([
      fetchAvinorXml({ airport: "OSL", TimeFrom: "1", TimeTo: "8", direction: "D" }),
      fetchAvinorXml({ airport: "BGO", TimeFrom: "1", TimeTo: "8", direction: "A" }),
    ]);

    // Build BGO arrival map: flightId → scheduled arrival time
    const bgoArrivals: Record<string, string> = {};
    for (const f of toArray(bgoData?.airport?.flights?.flight)) {
      if (f?.airport === "OSL" && f?.flight_id && f?.schedule_time) {
        bgoArrivals[String(f.flight_id)] = String(f.schedule_time);
      }
    }

    const flights: SasFlight[] = [];

    for (const f of toArray(depData?.airport?.flights?.flight)) {
      if (f?.airport !== "BGO") continue;
      if (f?.airline !== "SK") continue; // SAS only

      const schedDt = parseUtc(String(f?.schedule_time ?? ""));
      if (!schedDt) continue;
      if (schedDt < minDeparture) continue; // too early

      const statusCode = String(f?.status?.["@_code"] ?? "");
      const statusDt = parseUtc(String(f?.status?.["@_time"] ?? ""));
      const delayMin =
        schedDt && statusDt
          ? Math.round((statusDt.getTime() - schedDt.getTime()) / 60000)
          : null;

      flights.push({
        flightNumber: String(f?.flight_id ?? "-"),
        scheduledDeparture: fmtOslo(schedDt),
        actualDeparture:
          statusDt && statusDt.getTime() !== schedDt.getTime()
            ? fmtOslo(statusDt)
            : null,
        scheduledArrivalBgo: fmtOslo(parseUtc(bgoArrivals[String(f?.flight_id)] ?? "")),
        cancelled: statusCode === "C",
        delayed: f?.delayed === "Y" || (delayMin !== null && delayMin > 0),
        delayMinutes: delayMin && delayMin > 0 ? delayMin : null,
        gate: f?.gate ? String(f.gate) : null,
      });
    }

    flights.sort((a, b) => a.scheduledDeparture.localeCompare(b.scheduledDeparture));

    return NextResponse.json({
      flights: flights.slice(0, 2),
      oslArrival: fmtOslo(oslArrival),
      minDeparture: fmtOslo(minDeparture),
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ukjent feil" },
      { status: 500 }
    );
  }
}
