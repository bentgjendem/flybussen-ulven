import { NextRequest, NextResponse } from "next/server";

const ENTUR_API = "https://api.entur.io/journey-planner/v3/graphql";
const ET_CLIENT_NAME = "flybussen-ulven-osl";

// Verified stop IDs
const OKERN          = "NSR:StopPlace:58194";
const JERNBANETORGET = "NSR:StopPlace:58366";
const OSLO_S         = "NSR:StopPlace:59872";
const OSL_TOG        = "NSR:StopPlace:269";

const TRANSFER_MINUTES = 5; // walk from Jernbanetorget to Oslo S

const TRIP_QUERY = `
query GetLegs($from: String!, $to: String!, $dateTime: DateTime!, $num: Int!, $mode: TransportMode!) {
  trip(
    from: { place: $from }
    to: { place: $to }
    numTripPatterns: $num
    modes: { transportModes: [{ transportMode: $mode }] }
    dateTime: $dateTime
  ) {
    tripPatterns {
      duration
      legs {
        mode
        line { publicCode name }
        fromPlace { name }
        toPlace { name }
        expectedStartTime
        expectedEndTime
        aimedStartTime
        aimedEndTime
        realtime
      }
    }
  }
}
`;

interface RawLeg {
  mode: string;
  line?: { publicCode: string; name: string };
  fromPlace: { name: string };
  toPlace: { name: string };
  expectedStartTime: string;
  expectedEndTime: string;
  aimedStartTime: string;
  aimedEndTime: string;
  realtime: boolean;
}

export interface TransitLeg {
  mode: "metro" | "rail";
  lineCode: string;
  lineName: string;
  fromPlace: string;
  toPlace: string;
  aimedDeparture: string;
  expectedDeparture: string;
  aimedArrival: string;
  expectedArrival: string;
  realtime: boolean;
  delayMinutes: number;
}

export interface MetroFlyJourney {
  firstLeg: TransitLeg;
  transferMinutes: number;
  secondLeg: TransitLeg;
  totalDurationSeconds: number;
  expectedDeparture: string;
  expectedArrival: string;
}

async function fetchLegs(
  from: string,
  to: string,
  mode: "metro" | "rail",
  dateTime: string,
  num = 10
): Promise<TransitLeg[]> {
  const res = await fetch(ENTUR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": ET_CLIENT_NAME,
    },
    body: JSON.stringify({
      query: TRIP_QUERY,
      variables: { from, to, dateTime, num, mode },
    }),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Entur svarte med ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0]?.message);

  const patterns: { duration: number; legs: RawLeg[] }[] =
    json.data?.trip?.tripPatterns ?? [];

  return patterns
    .filter((p) => {
      // Only direct single-mode trips (no foot transfers between mode legs)
      const modeLegs = p.legs.filter((l) => l.mode === mode);
      return modeLegs.length === 1;
    })
    .map((p) => {
      const leg = p.legs.find((l) => l.mode === mode)!;
      const aimed = new Date(leg.aimedStartTime).getTime();
      const expected = new Date(leg.expectedStartTime).getTime();
      return {
        mode,
        lineCode: leg.line?.publicCode ?? mode,
        lineName: leg.line?.name ?? "",
        fromPlace: leg.fromPlace.name,
        toPlace: leg.toPlace.name,
        aimedDeparture: leg.aimedStartTime,
        expectedDeparture: leg.expectedStartTime,
        aimedArrival: leg.aimedEndTime,
        expectedArrival: leg.expectedEndTime,
        realtime: leg.realtime,
        delayMinutes: Math.round((expected - aimed) / 60000),
      } satisfies TransitLeg;
    });
}

function stitch(
  firstLegs: TransitLeg[],
  secondLegs: TransitLeg[],
  filterSecond: (l: TransitLeg) => boolean,
  transferMs: number
): MetroFlyJourney[] {
  const validSecond = secondLegs.filter(filterSecond);
  const journeys: MetroFlyJourney[] = [];

  for (const first of firstLegs) {
    const earliestSecond = new Date(first.expectedArrival).getTime() + transferMs;
    const second = validSecond.find(
      (s) => new Date(s.expectedDeparture).getTime() >= earliestSecond
    );
    if (!second) continue;

    const totalMs =
      new Date(second.expectedArrival).getTime() -
      new Date(first.expectedDeparture).getTime();

    journeys.push({
      firstLeg: first,
      transferMinutes: TRANSFER_MINUTES,
      secondLeg: second,
      totalDurationSeconds: Math.round(totalMs / 1000),
      expectedDeparture: first.expectedDeparture,
      expectedArrival: second.expectedArrival,
    });
  }

  // Deduplicate by same firstLeg + secondLeg combo
  const seen = new Set<string>();
  return journeys.filter((j) => {
    const key = `${j.firstLeg.expectedDeparture}|${j.secondLeg.expectedDeparture}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const direction = searchParams.get("direction") ?? "ulven-osl";
  const num = Math.min(parseInt(searchParams.get("num") ?? "4", 10), 10);
  const now = new Date().toISOString();
  const transferMs = TRANSFER_MINUTES * 60 * 1000;

  try {
    if (direction === "ulven-osl") {
      // Parallel: metro Økern→Jernbanetorget + Flytoget Oslo S→OSL
      const [metroLegs, flyLegs] = await Promise.all([
        fetchLegs(OKERN, JERNBANETORGET, "metro", now, 10),
        fetchLegs(OSLO_S, OSL_TOG, "rail", now, 20),
      ]);

      const journeys = stitch(
        metroLegs,
        flyLegs,
        (l) => l.lineCode.toUpperCase().startsWith("FLY"),
        transferMs
      ).slice(0, num);

      return NextResponse.json({ journeys, fetchedAt: new Date().toISOString() });
    } else {
      // osl-ulven: Flytoget OSL→Oslo S + metro Jernbanetorget→Økern
      const [flyLegs, metroLegs] = await Promise.all([
        fetchLegs(OSL_TOG, OSLO_S, "rail", now, 20),
        fetchLegs(JERNBANETORGET, OKERN, "metro", now, 20),
      ]);

      const journeys = stitch(
        flyLegs.filter((l) => l.lineCode.toUpperCase().startsWith("FLY")),
        metroLegs,
        () => true,
        transferMs
      ).slice(0, num);

      return NextResponse.json({ journeys, fetchedAt: new Date().toISOString() });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
