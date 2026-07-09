import { randomUUID } from "crypto";
import {
  destinations,
  accessLogs,
  accessLogVehicles,
  users,
  type Destination,
  type InsertDestination,
  type AccessLogWithDetails,
  type InsertAccessLogVehicle,
} from "@shared/schema";
import { db } from "../storage";
import { eq, and, desc, asc, gte, lte, or, ilike, isNull } from "drizzle-orm";

export async function getDestinations(
  orgId: string,
  activeOnly = true,
  locationId?: number | null,
): Promise<Destination[]> {
  const conditions = [eq(destinations.organizationId, orgId)];
  if (locationId != null) {
    conditions.push(or(eq(destinations.locationId, locationId), isNull(destinations.locationId))!);
  }
  if (activeOnly) {
    return db
      .select()
      .from(destinations)
      .where(and(...conditions, eq(destinations.active, true)))
      .orderBy(asc(destinations.name));
  }
  return db
    .select()
    .from(destinations)
    .where(and(...conditions))
    .orderBy(asc(destinations.name));
}

export async function createDestination(data: InsertDestination, orgId: string): Promise<Destination> {
  const [row] = await db
    .insert(destinations)
    .values({ ...data, organizationId: orgId })
    .returning();
  return row;
}

export async function updateDestination(
  id: number,
  data: Partial<InsertDestination>,
  orgId: string,
): Promise<Destination | undefined> {
  const [row] = await db
    .update(destinations)
    .set(data)
    .where(and(eq(destinations.id, id), eq(destinations.organizationId, orgId)))
    .returning();
  return row;
}

function hydrateAccessLog(
  log: typeof accessLogs.$inferSelect,
  vehicle: typeof accessLogVehicles.$inferSelect | null,
  destinationName: string,
  loggedByName: string | null,
): AccessLogWithDetails {
  return {
    ...log,
    destinationName,
    loggedByName,
    vehicle,
  };
}

export async function getCurrentlyInside(orgId: string): Promise<AccessLogWithDetails[]> {
  const rows = await db
    .select({
      log: accessLogs,
      destinationName: destinations.name,
      loggedByFirst: users.firstName,
      loggedByLast: users.lastName,
      vehicle: accessLogVehicles,
    })
    .from(accessLogs)
    .innerJoin(destinations, eq(accessLogs.destinationId, destinations.id))
    .leftJoin(users, eq(accessLogs.loggedByUserId, users.id))
    .leftJoin(accessLogVehicles, eq(accessLogVehicles.accessLogId, accessLogs.id))
    .where(and(eq(accessLogs.organizationId, orgId), eq(accessLogs.status, "inside")))
    .orderBy(desc(accessLogs.timeIn));

  return rows.map((r) =>
    hydrateAccessLog(
      r.log,
      r.vehicle ?? null,
      r.destinationName,
      r.loggedByFirst ? `${r.loggedByFirst} ${r.loggedByLast ?? ""}`.trim() : null,
    ),
  );
}

export async function getAccessLog(id: number, orgId: string): Promise<AccessLogWithDetails | undefined> {
  const rows = await db
    .select({
      log: accessLogs,
      destinationName: destinations.name,
      loggedByFirst: users.firstName,
      loggedByLast: users.lastName,
      vehicle: accessLogVehicles,
    })
    .from(accessLogs)
    .innerJoin(destinations, eq(accessLogs.destinationId, destinations.id))
    .leftJoin(users, eq(accessLogs.loggedByUserId, users.id))
    .leftJoin(accessLogVehicles, eq(accessLogVehicles.accessLogId, accessLogs.id))
    .where(and(eq(accessLogs.id, id), eq(accessLogs.organizationId, orgId)))
    .limit(1);

  const r = rows[0];
  if (!r) return undefined;
  return hydrateAccessLog(
    r.log,
    r.vehicle ?? null,
    r.destinationName,
    r.loggedByFirst ? `${r.loggedByFirst} ${r.loggedByLast ?? ""}`.trim() : null,
  );
}

export type CreateAccessPersonInput = {
  personFullName: string;
  personIdNumber?: string | null;
  personPhotoUrl?: string | null;
  partyRole?: string | null;
  scanData?: import("@shared/access-scan-data").AccessScanData | null;
};

export type CreateAccessEntryInput = {
  category: string;
  destinationId: number;
  personFullName: string;
  personIdNumber?: string | null;
  companyName?: string | null;
  contactNumber?: string | null;
  purpose?: string | null;
  personPhotoUrl?: string | null;
  vehiclePhotoUrl?: string | null;
  partyRole?: string | null;
  visitGroupId?: string | null;
  vehicle?: Omit<InsertAccessLogVehicle, "organizationId" | "accessLogId"> | null;
};

export type CreateAccessVisitInput = {
  category: string;
  destinationId: number;
  companyName?: string | null;
  contactNumber?: string | null;
  purpose?: string | null;
  vehiclePhotoUrl?: string | null;
  vehicle?: Omit<InsertAccessLogVehicle, "organizationId" | "accessLogId"> | null;
  workstationId?: number | null;
  people: CreateAccessPersonInput[];
};

function hasVehiclePayload(
  vehicle: Omit<InsertAccessLogVehicle, "organizationId" | "accessLogId"> | null | undefined,
): boolean {
  return !!vehicle && Object.values(vehicle).some((v) => v != null && String(v).trim() !== "");
}

export async function createAccessEntry(
  orgId: string,
  userId: string,
  input: CreateAccessEntryInput,
): Promise<AccessLogWithDetails> {
  const [entry] = await createAccessVisit(orgId, userId, {
    category: input.category,
    destinationId: input.destinationId,
    companyName: input.companyName,
    contactNumber: input.contactNumber,
    purpose: input.purpose,
    vehiclePhotoUrl: input.vehiclePhotoUrl,
    vehicle: input.vehicle,
    people: [
      {
        personFullName: input.personFullName,
        personIdNumber: input.personIdNumber,
        personPhotoUrl: input.personPhotoUrl,
        partyRole: input.partyRole ?? null,
      },
    ],
  });
  return entry;
}

/** Check in one or more people as a single visit (shared vehicle / destination). */
export async function createAccessVisit(
  orgId: string,
  userId: string,
  input: CreateAccessVisitInput,
): Promise<AccessLogWithDetails[]> {
  if (!input.people.length) {
    throw new Error("At least one person is required");
  }

  return db.transaction(async (tx) => {
    const visitGroupId =
      input.people.length > 1 || hasVehiclePayload(input.vehicle)
        ? randomUUID()
        : null;

    const [dest] = await tx
      .select({ name: destinations.name })
      .from(destinations)
      .where(eq(destinations.id, input.destinationId))
      .limit(1);

    const results: AccessLogWithDetails[] = [];

    for (const person of input.people) {
      const [log] = await tx
        .insert(accessLogs)
        .values({
          organizationId: orgId,
          category: input.category,
          destinationId: input.destinationId,
          status: "inside",
          visitGroupId,
          partyRole: person.partyRole ?? null,
          personFullName: person.personFullName,
          personIdNumber: person.personIdNumber ?? null,
          scanData: person.scanData ?? null,
          companyName: input.companyName ?? null,
          contactNumber: input.contactNumber ?? null,
          purpose: input.purpose ?? null,
          personPhotoUrl: person.personPhotoUrl ?? null,
          vehiclePhotoUrl: input.vehiclePhotoUrl ?? null,
          loggedByUserId: userId,
          workstationId: input.workstationId ?? null,
        })
        .returning();

      let vehicle: typeof accessLogVehicles.$inferSelect | null = null;
      if (hasVehiclePayload(input.vehicle) && input.vehicle) {
        const [v] = await tx
          .insert(accessLogVehicles)
          .values({
            accessLogId: log.id,
            organizationId: orgId,
            registration: input.vehicle.registration ?? null,
            make: input.vehicle.make ?? null,
            model: input.vehicle.model ?? null,
            colour: input.vehicle.colour ?? null,
            licenceDiscData: input.vehicle.licenceDiscData ?? null,
          })
          .returning();
        vehicle = v;
      }

      results.push(hydrateAccessLog(log, vehicle, dest?.name ?? "", null));
    }

    return results;
  });
}

export async function markAccessExit(id: number, orgId: string): Promise<AccessLogWithDetails | undefined> {
  const [updated] = await db
    .update(accessLogs)
    .set({ status: "exited", timeOut: new Date() })
    .where(and(eq(accessLogs.id, id), eq(accessLogs.organizationId, orgId), eq(accessLogs.status, "inside")))
    .returning();

  if (!updated) return undefined;
  return getAccessLog(updated.id, orgId);
}

export type AccessDestinationSummary = {
  destinationId: number;
  destinationName: string;
  destinationType: string;
  active: boolean;
  currentlyInside: number;
  checkInsToday: number;
  checkOutsToday: number;
  vehiclesInside: number;
  insideByCategory: Record<string, number>;
};

export type AccessOverview = {
  totals: {
    currentlyInside: number;
    checkInsToday: number;
    checkOutsToday: number;
    vehiclesInside: number;
  };
  destinations: AccessDestinationSummary[];
};

function startOfLocalDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function hasVehicleOnEntry(entry: AccessLogWithDetails): boolean {
  return !!(
    entry.vehicle?.registration
    || entry.vehicle?.make
    || entry.vehiclePhotoUrl
    || entry.vehicle?.licenceDiscData
  );
}

export async function getAccessOverview(orgId: string): Promise<AccessOverview> {
  const dests = await db
    .select()
    .from(destinations)
    .where(eq(destinations.organizationId, orgId))
    .orderBy(asc(destinations.name));

  const inside = await getCurrentlyInside(orgId);
  const startOfToday = startOfLocalDay();

  const todayRows = await db
    .select({
      destinationId: accessLogs.destinationId,
      timeIn: accessLogs.timeIn,
      timeOut: accessLogs.timeOut,
    })
    .from(accessLogs)
    .where(
      and(
        eq(accessLogs.organizationId, orgId),
        or(gte(accessLogs.timeIn, startOfToday), gte(accessLogs.timeOut, startOfToday)),
      ),
    );

  const destMap = new Map<number, AccessDestinationSummary>();
  for (const d of dests) {
    destMap.set(d.id, {
      destinationId: d.id,
      destinationName: d.name,
      destinationType: d.type,
      active: d.active,
      currentlyInside: 0,
      checkInsToday: 0,
      checkOutsToday: 0,
      vehiclesInside: 0,
      insideByCategory: {},
    });
  }

  for (const row of todayRows) {
    const summary = destMap.get(row.destinationId);
    if (!summary) continue;
    if (row.timeIn >= startOfToday) summary.checkInsToday++;
    if (row.timeOut && row.timeOut >= startOfToday) summary.checkOutsToday++;
  }

  const vehicleGroupsSeen = new Set<string>();

  for (const entry of inside) {
    const summary = destMap.get(entry.destinationId);
    if (!summary) continue;
    summary.currentlyInside++;
    summary.insideByCategory[entry.category] = (summary.insideByCategory[entry.category] ?? 0) + 1;
    if (hasVehicleOnEntry(entry)) {
      const groupKey = entry.visitGroupId ?? `solo-${entry.id}`;
      if (!vehicleGroupsSeen.has(`${entry.destinationId}:${groupKey}`)) {
        vehicleGroupsSeen.add(`${entry.destinationId}:${groupKey}`);
        summary.vehiclesInside++;
      }
    }
  }

  const destinationSummaries = [...destMap.values()];
  const totals = destinationSummaries.reduce(
    (acc, d) => ({
      currentlyInside: acc.currentlyInside + d.currentlyInside,
      checkInsToday: acc.checkInsToday + d.checkInsToday,
      checkOutsToday: acc.checkOutsToday + d.checkOutsToday,
      vehiclesInside: acc.vehiclesInside + d.vehiclesInside,
    }),
    { currentlyInside: 0, checkInsToday: 0, checkOutsToday: 0, vehiclesInside: 0 },
  );

  return { totals, destinations: destinationSummaries };
}

export async function getAccessActivity(
  orgId: string,
  opts?: {
    limit?: number;
    destinationId?: number;
    search?: string;
    status?: "inside" | "exited" | "all";
    category?: string;
    from?: Date;
    to?: Date;
  },
): Promise<AccessLogWithDetails[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 40, 1), 500);
  const conditions = [eq(accessLogs.organizationId, orgId)];

  if (opts?.destinationId != null) {
    conditions.push(eq(accessLogs.destinationId, opts.destinationId));
  }
  if (opts?.status === "inside") {
    conditions.push(eq(accessLogs.status, "inside"));
  } else if (opts?.status === "exited") {
    conditions.push(eq(accessLogs.status, "exited"));
  }
  if (opts?.category) {
    conditions.push(eq(accessLogs.category, opts.category));
  }
  if (opts?.from) {
    conditions.push(gte(accessLogs.timeIn, opts.from));
  }
  if (opts?.to) {
    conditions.push(lte(accessLogs.timeIn, opts.to));
  }
  if (opts?.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    conditions.push(
      or(ilike(accessLogs.personFullName, q), ilike(accessLogs.personIdNumber, q))!,
    );
  }

  const rows = await db
    .select({
      log: accessLogs,
      destinationName: destinations.name,
      loggedByFirst: users.firstName,
      loggedByLast: users.lastName,
      vehicle: accessLogVehicles,
    })
    .from(accessLogs)
    .innerJoin(destinations, eq(accessLogs.destinationId, destinations.id))
    .leftJoin(users, eq(accessLogs.loggedByUserId, users.id))
    .leftJoin(accessLogVehicles, eq(accessLogVehicles.accessLogId, accessLogs.id))
    .where(and(...conditions))
    .orderBy(desc(accessLogs.timeIn))
    .limit(limit);

  return rows.map((r) =>
    hydrateAccessLog(
      r.log,
      r.vehicle ?? null,
      r.destinationName,
      r.loggedByFirst ? `${r.loggedByFirst} ${r.loggedByLast ?? ""}`.trim() : null,
    ),
  );
}

export type AccessAnalytics = {
  periodDays: number;
  totalVisits: number;
  uniquePeople: number;
  avgVisitMinutes: number | null;
  byCategory: Record<string, number>;
  hourlyCheckInsToday: number[];
  topDestinations: Array<{ destinationId: number; destinationName: string; count: number }>;
};

export async function getAccessAnalytics(orgId: string, days = 7): Promise<AccessAnalytics> {
  const periodDays = Math.min(Math.max(days, 1), 90);
  const since = new Date();
  since.setDate(since.getDate() - periodDays);
  since.setHours(0, 0, 0, 0);
  const startOfToday = startOfLocalDay();

  const rows = await db
    .select({
      category: accessLogs.category,
      destinationId: accessLogs.destinationId,
      destinationName: destinations.name,
      timeIn: accessLogs.timeIn,
      timeOut: accessLogs.timeOut,
      personIdNumber: accessLogs.personIdNumber,
      personFullName: accessLogs.personFullName,
    })
    .from(accessLogs)
    .innerJoin(destinations, eq(accessLogs.destinationId, destinations.id))
    .where(and(eq(accessLogs.organizationId, orgId), gte(accessLogs.timeIn, since)));

  const byCategory: Record<string, number> = {};
  const destCounts = new Map<number, { name: string; count: number }>();
  const people = new Set<string>();
  const hourlyCheckInsToday = Array.from({ length: 24 }, () => 0);
  let durationTotalMinutes = 0;
  let durationCount = 0;

  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    const dest = destCounts.get(row.destinationId) ?? { name: row.destinationName, count: 0 };
    dest.count++;
    destCounts.set(row.destinationId, dest);

    const personKey = row.personIdNumber?.trim() || row.personFullName.trim().toLowerCase();
    if (personKey) people.add(personKey);

    if (row.timeIn >= startOfToday) {
      hourlyCheckInsToday[row.timeIn.getHours()]++;
    }

    if (row.timeOut) {
      const mins = (row.timeOut.getTime() - row.timeIn.getTime()) / 60_000;
      if (mins > 0 && mins < 24 * 60) {
        durationTotalMinutes += mins;
        durationCount++;
      }
    }
  }

  const topDestinations = [...destCounts.entries()]
    .map(([destinationId, v]) => ({
      destinationId,
      destinationName: v.name,
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    periodDays,
    totalVisits: rows.length,
    uniquePeople: people.size,
    avgVisitMinutes: durationCount > 0 ? Math.round(durationTotalMinutes / durationCount) : null,
    byCategory,
    hourlyCheckInsToday,
    topDestinations,
  };
}

export async function getPersonAccessHistory(
  orgId: string,
  opts: { personIdNumber?: string | null; personFullName?: string; excludeId?: number; limit?: number },
): Promise<AccessLogWithDetails[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const conditions = [eq(accessLogs.organizationId, orgId)];

  const id = opts.personIdNumber?.trim();
  const name = opts.personFullName?.trim();
  if (id) {
    conditions.push(eq(accessLogs.personIdNumber, id));
  } else if (name) {
    conditions.push(eq(accessLogs.personFullName, name));
  } else {
    return [];
  }

  const rows = await db
    .select({
      log: accessLogs,
      destinationName: destinations.name,
      loggedByFirst: users.firstName,
      loggedByLast: users.lastName,
      vehicle: accessLogVehicles,
    })
    .from(accessLogs)
    .innerJoin(destinations, eq(accessLogs.destinationId, destinations.id))
    .leftJoin(users, eq(accessLogs.loggedByUserId, users.id))
    .leftJoin(accessLogVehicles, eq(accessLogVehicles.accessLogId, accessLogs.id))
    .where(and(...conditions))
    .orderBy(desc(accessLogs.timeIn))
    .limit(limit + 1);

  return rows
    .map((r) =>
      hydrateAccessLog(
        r.log,
        r.vehicle ?? null,
        r.destinationName,
        r.loggedByFirst ? `${r.loggedByFirst} ${r.loggedByLast ?? ""}`.trim() : null,
      ),
    )
    .filter((e) => e.id !== opts.excludeId)
    .slice(0, limit);
}
