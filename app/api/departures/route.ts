import { NextRequest, NextResponse } from "next/server";

const ENTUR_API = "https://api.entur.io/journey-planner/v3/graphql";
const ET_CLIENT_NAME = "flybussen-ulven-osl";

const TRIP_QUERY = `
query GetTrips($from: String!, $to: String!, $dateTime: DateTime!) {
  trip(
    from: { place: $from }
    to: { place: $to }
    numTripPatterns: 10
    transportModes: [{ transportMode: bus }]
    dateTime: $dateTime
  ) {
    tripPatterns {
      duration
      legs {
        mode
        line {
          id
          name
          publicCode
        }
        fromPlace {
          name
          quay {
            publicCode
          }
        }
        toPlace {
          name
        }
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

export interface Departure {
  duration: number; // seconds
  lineName: string;
  lineCode: string;
  fromPlace: string;
  fromQuay: string | null;
  toPlace: string;
  aimedDeparture: string; // ISO
  expectedDeparture: string; // ISO
  aimedArrival: string; // ISO
  expectedArrival: string; // ISO
  realtime: boolean;
  delayMinutes: number;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") ?? "NSR:StopPlace:5920";
  const to = searchParams.get("to") ?? "NSR:StopPlace:58211";
  const dateTime = new Date().toISOString();

  try {
    const response = await fetch(ENTUR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ET-Client-Name": ET_CLIENT_NAME,
      },
      body: JSON.stringify({
        query: TRIP_QUERY,
        variables: { from, to, dateTime },
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Entur API svarte med ${response.status}`);
    }

    const json = await response.json();

    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? "GraphQL-feil");
    }

    const tripPatterns: unknown[] = json.data?.trip?.tripPatterns ?? [];

    const departures: Departure[] = tripPatterns
      .map((pattern: unknown) => {
        const p = pattern as {
          duration: number;
          legs: Array<{
            mode: string;
            line?: { id: string; name: string; publicCode: string };
            fromPlace: { name: string; quay?: { publicCode: string } };
            toPlace: { name: string };
            expectedStartTime: string;
            expectedEndTime: string;
            aimedStartTime: string;
            aimedEndTime: string;
            realtime: boolean;
          }>;
        };

        // Pick the first bus/coach leg as the primary leg
        const leg = p.legs.find((l) => l.mode === "bus" || l.mode === "coach");
        if (!leg) return null;

        const aimedMs = new Date(leg.aimedStartTime).getTime();
        const expectedMs = new Date(leg.expectedStartTime).getTime();
        const delayMinutes = Math.round((expectedMs - aimedMs) / 60000);

        return {
          duration: p.duration,
          lineName: leg.line?.name ?? "Flybussen",
          lineCode: leg.line?.publicCode ?? "FB",
          fromPlace: leg.fromPlace.name,
          fromQuay: leg.fromPlace.quay?.publicCode ?? null,
          toPlace: leg.toPlace.name,
          aimedDeparture: leg.aimedStartTime,
          expectedDeparture: leg.expectedStartTime,
          aimedArrival: leg.aimedEndTime,
          expectedArrival: leg.expectedEndTime,
          realtime: leg.realtime,
          delayMinutes,
        } satisfies Departure;
      })
      .filter((d): d is Departure => d !== null);

    return NextResponse.json({
      departures,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Ukjent feil";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
