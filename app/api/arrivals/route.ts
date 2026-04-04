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
  scheduledDepartureBgo: string;  // HH:mm avgangstid fra Bergen
  scheduledArrivalOsl: string;    // HH:mm landingstid ved Oslo
  actualArrivalOsl: string | null;
  cancelled: boolean;
  delayed: boolean;
  delayMinutes: number | null;
  gate: string | null;
  landed: boolean;
  minutesAgo: number | null;
  minutesUntil: number | null;
}

export async function GET() {
  const now = new Date();
  const recentCutoff = new Date(now.getTime() - 75 * 60 * 1000); // vis fly som landet inntil 75 min siden

  try {
    // Speil-mønster fra flights/route.ts, men omvendt retning:
    // – BGO avganger (direction: "D") med f.airport === "OSL"  → SAS BGO→OSL fly
    // – OSL ankomster (direction: "A") med f.airport === "BGO" → landingstider ved Oslo
    const [bgoData, oslData] = await Promise.all([
      fetchAvinorXml({ airport: "BGO", TimeFrom: "0", TimeTo: "8", direction: "D" }),
      fetchAvinorXml({ airport: "OSL", TimeFrom: "0", TimeTo: "8", direction: "A" }),
    ]);

    // Bygg OSL-ankomstkart: flightId → { schedTime, statusCode, statusTime, gate, delayed }
    type OslArrInfo = { schedTime: string; statusCode: string; statusTime: string; gate: string; delayed: string };
    const oslArrMap: Record<string, OslArrInfo> = {};
    for (const f of toArray(oslData?.airport?.flights?.flight)) {
      if (f?.airport !== "BGO") continue;  // ankomster fra Bergen
      if (!f?.flight_id) continue;
      oslArrMap[String(f.flight_id)] = {
        schedTime:  String(f?.schedule_time ?? ""),
        statusCode: String(f?.status?.["@_code"] ?? ""),
        statusTime: String(f?.status?.["@_time"] ?? ""),
        gate:       f?.gate ? String(f.gate) : "",
        delayed:    String(f?.delayed ?? ""),
      };
    }

    const arrivals: SasArrival[] = [];

    for (const f of toArray(bgoData?.airport?.flights?.flight)) {
      if (f?.airport !== "OSL") continue;  // kun fly til Oslo
      if (f?.airline !== "SK") continue;   // kun SAS

      const flightId   = String(f?.flight_id ?? "");
      const bgoSchedDt = parseUtc(String(f?.schedule_time ?? ""));
      if (!bgoSchedDt) continue;

      // Hent OSL-ankomstdata
      const arr = oslArrMap[flightId];
      const oslSchedDt  = arr ? parseUtc(arr.schedTime)  : null;
      const oslStatusDt = arr ? parseUtc(arr.statusTime) : null;
      const oslStatus   = arr?.statusCode ?? "";

      // Primær visningstid er OSL-landing; fallback til BGO-avgang hvis mangler
      const primaryDt = oslSchedDt ?? bgoSchedDt;
      if (primaryDt < recentCutoff) continue;

      const actualOslDt =
        oslStatusDt && oslSchedDt && oslStatusDt.getTime() !== oslSchedDt.getTime()
          ? oslStatusDt
          : null;

      const delayMin =
        oslSchedDt && oslStatusDt
          ? Math.round((oslStatusDt.getTime() - oslSchedDt.getTime()) / 60000)
          : null;

      const landed    = oslStatus === "A";
      const cancelled = oslStatus === "C";
      const effectiveDt = actualOslDt ?? primaryDt;

      arrivals.push({
        flightNumber:          flightId,
        scheduledDepartureBgo: fmtOslo(bgoSchedDt),
        scheduledArrivalOsl:   fmtOslo(oslSchedDt ?? bgoSchedDt),
        actualArrivalOsl:      actualOslDt ? fmtOslo(actualOslDt) : null,
        cancelled,
        delayed:       arr?.delayed === "Y" || (delayMin !== null && delayMin > 0),
        delayMinutes:  delayMin && delayMin > 0 ? delayMin : null,
        gate:          arr?.gate || null,
        landed,
        minutesAgo:    landed  ? Math.round((now.getTime() - effectiveDt.getTime()) / 60000) : null,
        minutesUntil:  !landed ? Math.round((effectiveDt.getTime() - now.getTime()) / 60000) : null,
      });
    }

    arrivals.sort((a, b) => a.scheduledArrivalOsl.localeCompare(b.scheduledArrivalOsl));

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
