import {
  type User, type InsertUser,
  type Organization, type InsertOrganization,
  type Location, type InsertLocation,
  type Category, type InsertCategory,
  type Incident, type InsertIncident,
  type FormField, type InsertFormField,
  type Attachment, type InsertAttachment, type AttachmentWithUploader,
  type EvidenceNote, type InsertEvidenceNote, type EvidenceNoteWithAuthor,
  type AuditLog, type InsertAuditLog,
  type CustomMap, type InsertCustomMap,
  type ImportBatch, type InsertImportBatch,
  type NotificationLog, type InsertNotificationLog,
  type LiveResponder,
  type ChatMessage,
  type Command, type InsertCommand, type CommandUser,
  type CommandVisibilityGrant, type InsertCommandVisibilityGrant,
  type CommandVisibilityRequest, type InsertCommandVisibilityRequest,
  users, organizations, locations, incidentCategories, incidents, formFields, userLocationAssignments, incidentAttachments, incidentEvidenceNotes, auditLogs, customMaps, importBatches, pushSubscriptions, notificationLogs, liveResponders, chatMessages, chatReads, panicAcknowledgers, fcmTokens,
  commands, commandUsers, commandVisibilityGrants, commandVisibilityRequests,
  trackerDevices,
} from "@shared/schema";

export type TrackerDeviceSummary = {
  id: number;
  imei: string;
  label: string | null;
  commandId: number | null;
  commandName: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
  lastIgnitionOn: boolean | null;
  lastGpsValid: boolean | null;
  lastPositionAt: string | null;
  lastSeenAt: string | null;
};

export type LiveResponderSummary = {
  id: number;
  userId: string;
  firstName: string;
  lastName: string;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | null;
  joinedAt: string;
  arrivedAt: string | null;
  arrivalNote: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  destinationName: string | null;
};

export type LiveIncident = Incident & {
  responderFirstName: string | null;
  responderLastName: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  responders: LiveResponderSummary[];
  severity: string | null;
};
import { eq, desc, sql, asc, and, gt, gte, lte, inArray, isNull, isNotNull, or, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool);

export interface IStorage {
  // Organizations
  createOrganization(org: InsertOrganization): Promise<Organization>;
  getOrganization(id: string): Promise<Organization | undefined>;
  updateOrganizationComplimentary(orgId: string, isComplimentary: boolean): Promise<Organization>;
  updateOrganization(orgId: string, data: Partial<Organization>): Promise<Organization>;
  getOrgsWithUsage(): Promise<Array<Organization & { userCounts: { administrator: number; supervisor: number; reporter: number; total: number }; incidentCount: number; lastActivityAt: Date | null }>>;
  getOrgStorageBytes(orgId: string): Promise<number>;
  getOrgUsage(orgId: string): Promise<{
    userCounts: { administrator: number; supervisor: number; reporter: number; total: number };
    incidentsTotal: number;
    incidentsThisMonth: number;
    activeUsers30d: number;
    attachmentCount: number;
    storageBytes: number;
    lastActivityAt: Date | null;
    monthlyTotal: number | null;
    pushSentThisMonth: number;
    pushSentTotal: number;
    pushSubscriberCount: number;
    geocodedIncidentCount: number;
  }>;
  getArchonSummary(): Promise<{
    totalOrgCount: number;
    activeOrgCount: number;
    totalUsers: number;
    totalIncidents: number;
    incidentsThisMonth: number;
    estimatedMrrCents: number;
  }>;
  getAllUsersWithOrgs(): Promise<Array<User & { orgName: string; orgIsComplimentary: boolean; orgSubscriptionStatus: string; orgTrialEndsAt: Date | null }>>;

  // Users
  getUserById(id: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersByOrg(orgId: string): Promise<User[]>;
  getActiveUsersByOrg(orgId: string): Promise<User[]>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByInviteToken(token: string): Promise<User | undefined>;
  atomicConsumeInviteToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser & { role?: string }): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  updateUserLastSeen(id: string, position?: { lat: number; lng: number }): Promise<void>;
  deleteUser(id: string, orgId: string): Promise<boolean>;
  getUserCount(): Promise<number>;

  // Locations (org-scoped, optionally command-scoped)
  getLocations(orgId: string, commandFilter?: number[]): Promise<Location[]>;
  getLocation(id: number, orgId: string): Promise<Location | undefined>;
  createLocation(location: InsertLocation, orgId: string): Promise<Location>;
  updateLocation(id: number, location: Partial<InsertLocation>, orgId: string): Promise<Location | undefined>;
  deleteLocation(id: number, orgId: string): Promise<boolean>;

  // Categories (org-scoped, optionally command-scoped)
  getCategories(orgId: string, commandFilter?: number[]): Promise<Category[]>;
  getCategory(id: number, orgId: string): Promise<Category | undefined>;
  createCategory(category: InsertCategory, orgId: string): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory>, orgId: string): Promise<Category | undefined>;
  deleteCategory(id: number, orgId: string): Promise<boolean>;
  ensureOtherCategory(orgId: string, commandId?: number | null): Promise<Category>;

  // Incidents (org-scoped, optionally command-scoped)
  getIncidents(orgId: string, restrictToLocationIds?: number[], commandFilter?: number[]): Promise<Incident[]>;
  getLiveIncidents(orgId: string, commandFilter?: number[]): Promise<LiveIncident[]>;
  getIncident(id: number, orgId: string): Promise<Incident | undefined>;
  createIncident(incident: InsertIncident, orgId: string, userId?: string): Promise<Incident>;
  updateIncident(id: number, incident: Partial<InsertIncident>, orgId: string): Promise<Incident | undefined>;
  escalateIncident(id: number, orgId: string): Promise<Incident | undefined>;
  deleteIncident(id: number, orgId: string): Promise<boolean>;
  getIncidentStats(orgId: string, startDate?: string, endDate?: string, restrictToLocationIds?: number[], commandFilter?: number[]): Promise<any>;
  ensureLiveIncidentCategory(orgId: string, commandId?: number | null): Promise<Category>;

  // Live Responders (joiners)
  joinLiveIncident(incidentId: number, orgId: string, userId: string): Promise<LiveResponder>;
  leaveLiveIncident(incidentId: number, orgId: string, userId: string): Promise<void>;
  recordJoinerArrival(incidentId: number, orgId: string, userId: string, arrivedAt: Date, arrivalNote: string | null): Promise<void>;
  updateLiveResponderPosition(incidentId: number, orgId: string, userId: string, lat: number, lng: number): Promise<void>;
  updateLiveResponderDestination(incidentId: number, orgId: string, userId: string, lat: number, lng: number, name: string): Promise<void>;
  getActiveLiveResponders(incidentId: number, orgId: string): Promise<Array<LiveResponder & { firstName: string; lastName: string }>>;
  getIncidentResponders(incidentId: number, orgId: string): Promise<Array<LiveResponder & { firstName: string; lastName: string }>>;
  getIncidentsByResponder(userId: string, orgId: string): Promise<Array<{ incidentId: number; joinedAt: Date; leftAt: Date | null; arrivedAt: Date | null; arrivalNote: string | null; incidentDate: string; incidentTime: string; categoryId: number | null; description: string | null; creatorFirstName: string | null; creatorLastName: string | null }>>;
  closeAllLiveResponders(incidentId: number, orgId: string): Promise<void>;
  getActiveLiveResponderByUser(incidentId: number, orgId: string, userId: string): Promise<LiveResponder | undefined>;

  // User Location Assignments
  getUserLocationAssignments(userId: string, orgId: string): Promise<number[]>;
  setUserLocationAssignments(userId: string, locationIds: number[], orgId: string): Promise<void>;

  // Form Fields (org-scoped, optionally command-scoped)
  getFormFields(orgId: string, commandFilter?: number[]): Promise<FormField[]>;
  getFormField(id: number, orgId: string): Promise<FormField | undefined>;
  createFormField(field: InsertFormField, orgId: string): Promise<FormField>;
  updateFormField(id: number, field: Partial<InsertFormField>, orgId: string): Promise<FormField | undefined>;
  deleteFormField(id: number, orgId: string): Promise<boolean>;

  // Attachments (org-scoped)
  getAttachmentsByIncident(incidentId: number, orgId: string): Promise<AttachmentWithUploader[]>;
  getAttachment(id: number, orgId: string): Promise<Attachment | undefined>;
  createAttachment(data: InsertAttachment & { uploadedByUserId?: string | null }): Promise<Attachment>;
  deleteAttachment(id: number, orgId: string): Promise<boolean>;
  getAttachmentCountsByOrg(orgId: string): Promise<Record<number, number>>;

  // Post-incident text evidence notes (org-scoped)
  getEvidenceNotesByIncident(incidentId: number, orgId: string): Promise<EvidenceNoteWithAuthor[]>;
  getEvidenceNote(id: number, orgId: string): Promise<EvidenceNote | undefined>;
  createEvidenceNote(data: InsertEvidenceNote & { authorUserId?: string | null }): Promise<EvidenceNote>;
  deleteEvidenceNote(id: number, orgId: string): Promise<boolean>;

  // Custom Maps (org-scoped)
  getCustomMaps(orgId: string, commandFilter?: number[]): Promise<CustomMap[]>;
  getCustomMap(id: number, orgId: string): Promise<CustomMap | undefined>;
  createCustomMap(data: InsertCustomMap, orgId: string, commandId?: number | null): Promise<CustomMap>;
  deleteCustomMap(id: number, orgId: string): Promise<boolean>;

  // Audit Logs
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogsByUser(userId: string, orgId: string, since?: Date): Promise<AuditLog[]>;
  getRecentPanicAlerts(orgId: string, since: Date): Promise<Array<{ id: number; userId: string | null; firstName: string; lastName: string; contactNumber: string | null; lat: number | null; lng: number | null; createdAt: Date; panicAcknowledgedAt: Date | null; panicClosedAt: Date | null; acknowledgedBy: Array<{ userId: string; firstName: string; lastName: string; acknowledgedAt: Date; arrivedAt: Date | null }> }>>;
  acknowledgePanic(incidentId: number, orgId: string, acknowledgedByUserId: string): Promise<void>;
  closePanic(incidentId: number, orgId: string): Promise<void>;
  getAllUnacknowledgedPanicsForReminder(): Promise<Array<{ id: number; organizationId: string; userId: string | null; firstName: string | null; lastName: string | null }>>;

  // Import Batches (org-scoped)
  createImportBatch(data: InsertImportBatch): Promise<ImportBatch>;
  getImportBatch(id: number, orgId: string): Promise<ImportBatch | undefined>;
  listImportBatches(orgId: string): Promise<ImportBatch[]>;
  updateImportBatch(id: number, orgId: string, data: Partial<ImportBatch>): Promise<ImportBatch | undefined>;
  claimImportBatchForCommit(id: number, orgId: string): Promise<ImportBatch | undefined>;
  deleteImportBatchAndIncidents(id: number, orgId: string): Promise<{ deletedIncidents: number; deletedCategoryIds: number[]; deletedLocationIds: number[] }>;
  bulkCreateIncidents(rows: (InsertIncident & { organizationId: string; importBatchId: number })[]): Promise<number>;

  // Push Subscriptions (org-scoped)
  upsertPushSubscription(orgId: string, userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  deletePushSubscription(endpoint: string): Promise<void>;
  deletePushSubscriptionByUser(endpoint: string, userId: string): Promise<void>;
  /** Remove browser push endpoints when the user switches to the native app (FCM). */
  deleteAllPushSubscriptionsByUser(userId: string): Promise<void>;
  getPushSubscriptionsByOrg(orgId: string, excludeUserId?: string, roles?: string[], commandIds?: number[]): Promise<Array<{ endpoint: string; p256dh: string; auth: string; userId: string }>>;
  getPushSubscriptionsByUser(userId: string): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>>;
  getOrgPushSubscribedUserIds(orgId: string): Promise<Set<string>>;
  getOrgPushRegistrationByUser(orgId: string): Promise<Map<string, { fcm: boolean; web: boolean }>>;

  // FCM Tokens (native push)
  upsertFcmToken(orgId: string, userId: string, token: string): Promise<void>;
  deleteFcmToken(token: string): Promise<void>;
  getFcmTokensByOrg(orgId: string, excludeUserId?: string, roles?: string[], commandIds?: number[]): Promise<Array<{ token: string; userId: string }>>;
  getUserIdsInCommands(orgId: string, commandIds: number[]): Promise<Set<string>>;
  getFcmTokensByUser(userId: string): Promise<Array<{ token: string }>>;

  countLiveIncidents(orgId: string): Promise<number>;
  getAllLiveIncidentsForStaleCheck(): Promise<Array<{ id: number; organizationId: string; userId: string | null; responderPositionUpdatedAt: Date | null; liveStartedAt: Date | null; responderFirstName: string | null; responderLastName: string | null }>>;

  // Notification Logs (org-scoped)
  createNotificationLog(data: InsertNotificationLog): Promise<NotificationLog>;
  getNotificationLogsByUser(userId: string, orgId: string, since?: Date): Promise<NotificationLog[]>;
  hasNotificationLogWithUrl(orgId: string, userId: string, url: string): Promise<boolean>;
  deleteNotificationLogsByUserAndUrl(orgId: string, userId: string, url: string): Promise<void>;

  // Archon: destroy entire org and all its data
  deleteOrganization(orgId: string): Promise<void>;

  // Chat
  getChatMessages(orgId: string, userId: string, opts: { type: 'group'; limit: number; before?: number } | { type: 'dm'; withUserId: string; limit: number; before?: number }): Promise<Array<ChatMessage & { senderFirstName: string; senderLastName: string; senderAvatarUrl: string | null }>>;
  sendChatMessage(orgId: string, senderId: string, recipientId: string | null, content: string): Promise<ChatMessage & { senderFirstName: string; senderLastName: string; senderAvatarUrl: string | null }>;
  getChatMessageById(id: number, orgId: string): Promise<ChatMessage | undefined>;
  deleteChatMessage(id: number, orgId: string): Promise<boolean>;
  clearGroupChatMessages(orgId: string): Promise<number>;
  getChatConversations(orgId: string, userId: string): Promise<Array<{ recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; recipientAvatarUrl: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number }>>;
  markThreadRead(orgId: string, userId: string, recipientId: string | null): Promise<void>;

  getTrackerDevices(orgId: string, commandFilter?: number[]): Promise<TrackerDeviceSummary[]>;

  // Dashboard
  getDashboardSummary(orgId: string, period: 'day' | 'week', restrictToLocationIds?: number[], commandFilter?: number[], restrictToUserId?: string): Promise<{
    totalIncidents: number;
    liveCount: number;
    chartData: Array<{ label: string; count: number }>;
    users: Array<{ id: string; firstName: string; lastName: string; role: string; avatarUrl: string | null; incidentCount: number; isLive: boolean; liveIncidentId: number | null; lastSeenAt: Date | null; lastLat: number | null; lastLng: number | null; lastPositionAt: Date | null }>;
  }>;
}

export class DatabaseStorage implements IStorage {
  // --- Organizations ---
  async createOrganization(org: InsertOrganization): Promise<Organization> {
    const trialEndsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    // Respect caller-supplied subscriptionStatus (Archon passes "active");
    // default to "trial" only when not explicitly set.
    const [created] = await db.insert(organizations).values({
      ...org,
      trialEndsAt,
      subscriptionStatus: org.subscriptionStatus ?? "trial",
    }).returning();
    return created;
  }

  async getOrganization(id: string): Promise<Organization | undefined> {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
    return org;
  }

  async updateOrganizationComplimentary(orgId: string, isComplimentary: boolean): Promise<Organization> {
    const [updated] = await db.update(organizations).set({ isComplimentary }).where(eq(organizations.id, orgId)).returning();
    return updated;
  }

  async updateOrganization(orgId: string, data: Partial<Organization>): Promise<Organization> {
    const { id: _id, createdAt: _ca, ...safeData } = data as any;
    const [updated] = await db.update(organizations).set(safeData).where(eq(organizations.id, orgId)).returning();
    return updated;
  }

  async getOrgsWithUsage(): Promise<Array<Organization & { userCounts: { administrator: number; supervisor: number; reporter: number; total: number }; incidentCount: number; lastActivityAt: Date | null }>> {
    const allOrgs = await db.select().from(organizations).orderBy(organizations.name);
    const results = await Promise.all(
      allOrgs.map(async (org) => {
        const orgUsers = await db
          .select({ role: users.role, lastSeenAt: users.lastSeenAt })
          .from(users)
          .where(eq(users.organizationId, org.id));

        const userCounts = { administrator: 0, supervisor: 0, reporter: 0, total: 0 };
        let lastActivityAt: Date | null = null;
        for (const u of orgUsers) {
          if (u.role === "administrator") userCounts.administrator++;
          else if (u.role === "supervisor") userCounts.supervisor++;
          else if (u.role === "reporter") userCounts.reporter++;
          userCounts.total++;
          if (u.lastSeenAt && (!lastActivityAt || u.lastSeenAt > lastActivityAt)) {
            lastActivityAt = u.lastSeenAt;
          }
        }

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(incidents)
          .where(eq(incidents.organizationId, org.id));

        return { ...org, userCounts, incidentCount: count ?? 0, lastActivityAt };
      })
    );
    return results;
  }

  async getOrgStorageBytes(_orgId: string): Promise<number> {
    // Attachment size column not yet added — returns 0 until Task #256 instruments it
    return 0;
  }

  async getOrgUsage(orgId: string) {
    const orgUsers = await db
      .select({ role: users.role, lastSeenAt: users.lastSeenAt })
      .from(users)
      .where(eq(users.organizationId, orgId));

    const userCounts = { administrator: 0, supervisor: 0, reporter: 0, total: 0 };
    let lastActivityAt: Date | null = null;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let activeUsers30d = 0;

    for (const u of orgUsers) {
      if (u.role === "administrator") userCounts.administrator++;
      else if (u.role === "supervisor") userCounts.supervisor++;
      else if (u.role === "reporter") userCounts.reporter++;
      userCounts.total++;
      if (u.lastSeenAt) {
        if (!lastActivityAt || u.lastSeenAt > lastActivityAt) lastActivityAt = u.lastSeenAt;
        if (u.lastSeenAt >= thirtyDaysAgo) activeUsers30d++;
      }
    }

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [{ incidentsTotal }] = await db
      .select({ incidentsTotal: sql<number>`count(*)::int` })
      .from(incidents)
      .where(eq(incidents.organizationId, orgId));

    const [{ incidentsThisMonth }] = await db
      .select({ incidentsThisMonth: sql<number>`count(*)::int` })
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), gte(incidents.createdAt, firstDayOfMonth)));

    // Most recent incident timestamp — combined with user lastSeenAt for true last activity
    const [{ latestIncident }] = await db
      .select({ latestIncident: sql<Date | null>`max(${incidents.createdAt})` })
      .from(incidents)
      .where(eq(incidents.organizationId, orgId));

    if (latestIncident && (!lastActivityAt || latestIncident > lastActivityAt)) {
      lastActivityAt = latestIncident;
    }

    const [{ attachmentCount }] = await db
      .select({ attachmentCount: sql<number>`count(*)::int` })
      .from(incidentAttachments)
      .where(eq(incidentAttachments.organizationId, orgId));

    const storageBytes = await this.getOrgStorageBytes(orgId);

    const [{ pushSentThisMonth }] = await db
      .select({ pushSentThisMonth: sql<number>`count(*)::int` })
      .from(notificationLogs)
      .where(and(eq(notificationLogs.organizationId, orgId), gte(notificationLogs.createdAt, firstDayOfMonth)));

    const [{ pushSentTotal }] = await db
      .select({ pushSentTotal: sql<number>`count(*)::int` })
      .from(notificationLogs)
      .where(eq(notificationLogs.organizationId, orgId));

    const [{ pushSubscriberCount }] = await db
      .select({ pushSubscriberCount: sql<number>`count(*)::int` })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.organizationId, orgId));

    const [{ geocodedIncidentCount }] = await db
      .select({ geocodedIncidentCount: sql<number>`count(*)::int` })
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), sql`${incidents.latitude} IS NOT NULL`));

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    let monthlyTotal: number | null = null;
    if (org && (org.rateAdmin != null || org.rateSupervisor != null || org.rateReporter != null)) {
      monthlyTotal =
        userCounts.administrator * (org.rateAdmin ?? 0) +
        userCounts.supervisor * (org.rateSupervisor ?? 0) +
        userCounts.reporter * (org.rateReporter ?? 0);
    }

    return {
      userCounts,
      incidentsTotal: incidentsTotal ?? 0,
      incidentsThisMonth: incidentsThisMonth ?? 0,
      activeUsers30d,
      attachmentCount: attachmentCount ?? 0,
      storageBytes,
      lastActivityAt,
      monthlyTotal,
      pushSentThisMonth: pushSentThisMonth ?? 0,
      pushSentTotal: pushSentTotal ?? 0,
      pushSubscriberCount: pushSubscriberCount ?? 0,
      geocodedIncidentCount: geocodedIncidentCount ?? 0,
    };
  }

  async getArchonSummary() {
    const allOrgs = await db.select().from(organizations);
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let activeOrgCount = 0;
    for (const org of allOrgs) {
      if (org.isComplimentary || org.subscriptionStatus === "active") activeOrgCount++;
      else if (org.subscriptionStatus === "trial" && org.trialEndsAt && org.trialEndsAt > now) activeOrgCount++;
    }

    const [{ totalUsers }] = await db.select({ totalUsers: sql<number>`count(*)::int` }).from(users);
    const [{ totalIncidents }] = await db.select({ totalIncidents: sql<number>`count(*)::int` }).from(incidents);
    const [{ incidentsThisMonth }] = await db
      .select({ incidentsThisMonth: sql<number>`count(*)::int` })
      .from(incidents)
      .where(gte(incidents.createdAt, firstDayOfMonth));

    const orgsWithUsage = await this.getOrgsWithUsage();
    let estimatedMrrCents = 0;
    for (const org of orgsWithUsage) {
      if (org.rateAdmin == null && org.rateSupervisor == null && org.rateReporter == null) continue;
      estimatedMrrCents +=
        org.userCounts.administrator * (org.rateAdmin ?? 0) +
        org.userCounts.supervisor * (org.rateSupervisor ?? 0) +
        org.userCounts.reporter * (org.rateReporter ?? 0);
    }

    return {
      totalOrgCount: allOrgs.length,
      activeOrgCount,
      totalUsers: totalUsers ?? 0,
      totalIncidents: totalIncidents ?? 0,
      incidentsThisMonth: incidentsThisMonth ?? 0,
      estimatedMrrCents,
    };
  }

  async getAllUsersWithOrgs(): Promise<Array<User & { orgName: string; orgIsComplimentary: boolean; orgSubscriptionStatus: string; orgTrialEndsAt: Date | null }>> {
    const rows = await db
      .select({
        id: users.id,
        organizationId: users.organizationId,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        contactNumber: users.contactNumber,
        homeAddress: users.homeAddress,
        posting: users.posting,
        role: users.role,
        isActive: users.isActive,
        password: users.password,
        canEditIncidents: users.canEditIncidents,
        canManageAttachments: users.canManageAttachments,
        canDeleteIncidents: users.canDeleteIncidents,
        mustChangePassword: users.mustChangePassword,
        avatarUrl: users.avatarUrl,
        inviteToken: users.inviteToken,
        inviteTokenExpiresAt: users.inviteTokenExpiresAt,
        lastSeenAt: users.lastSeenAt,
        isSuperadmin: users.isSuperadmin,
        orgName: organizations.name,
        orgIsComplimentary: organizations.isComplimentary,
        orgSubscriptionStatus: organizations.subscriptionStatus,
        orgTrialEndsAt: organizations.trialEndsAt,
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .orderBy(organizations.name, users.lastName);
    return rows;
  }

  // --- Users ---
  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUsersByOrg(orgId: string): Promise<User[]> {
    return db.select().from(users).where(eq(users.organizationId, orgId));
  }

  async getActiveUsersByOrg(orgId: string): Promise<User[]> {
    return db.select().from(users).where(
      and(eq(users.organizationId, orgId), eq(users.isActive, true))
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByInviteToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.inviteToken, token));
    return user;
  }

  async atomicConsumeInviteToken(token: string): Promise<User | undefined> {
    // Single conditional UPDATE — validates token existence, expiry, and active status
    // while consuming it atomically. If concurrent requests race, only one will find a row.
    const now = new Date();
    const [user] = await db
      .update(users)
      .set({ inviteToken: null, inviteTokenExpiresAt: null })
      .where(
        and(
          eq(users.inviteToken, token),
          gt(users.inviteTokenExpiresAt, now),
          eq(users.isActive, true)
        )
      )
      .returning();
    return user;
  }

  async createUser(insertUser: InsertUser & { role?: string }): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async updateUserLastSeen(id: string, position?: { lat: number; lng: number }): Promise<void> {
    const patch: Partial<User> = { lastSeenAt: new Date() };
    if (
      position &&
      Number.isFinite(position.lat) &&
      Number.isFinite(position.lng)
    ) {
      patch.lastLat = position.lat;
      patch.lastLng = position.lng;
      patch.lastPositionAt = new Date();
    }
    await db.update(users).set(patch).where(eq(users.id, id));
  }

  async deleteUser(id: string, orgId: string): Promise<boolean> {
    await db.delete(users).where(and(eq(users.id, id), eq(users.organizationId, orgId)));
    return true;
  }

  async getUserCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result.count);
  }

  // --- Locations ---
  async getLocations(orgId: string, commandFilter?: number[]): Promise<Location[]> {
    if (commandFilter && commandFilter.length > 0) {
      return db.select().from(locations).where(and(
        eq(locations.organizationId, orgId),
        inArray(locations.commandId, commandFilter),
      ));
    }
    return db.select().from(locations).where(eq(locations.organizationId, orgId));
  }

  async getLocation(id: number, orgId: string): Promise<Location | undefined> {
    const [loc] = await db.select().from(locations).where(and(eq(locations.id, id), eq(locations.organizationId, orgId)));
    return loc;
  }

  async createLocation(location: InsertLocation, orgId: string): Promise<Location> {
    const [created] = await db.insert(locations).values({ ...location, organizationId: orgId }).returning();
    return created;
  }

  async updateLocation(id: number, location: Partial<InsertLocation>, orgId: string): Promise<Location | undefined> {
    const [updated] = await db.update(locations).set(location).where(and(eq(locations.id, id), eq(locations.organizationId, orgId))).returning();
    return updated;
  }

  async deleteLocation(id: number, orgId: string): Promise<boolean> {
    await db.delete(locations).where(and(eq(locations.id, id), eq(locations.organizationId, orgId)));
    return true;
  }

  // --- Categories ---
  async getCategories(orgId: string, commandFilter?: number[]): Promise<Category[]> {
    if (commandFilter && commandFilter.length > 0) {
      const scoped = await db.select().from(incidentCategories).where(and(
        eq(incidentCategories.organizationId, orgId),
        inArray(incidentCategories.commandId, commandFilter),
      ));
      // If this command has no categories yet (e.g. newly created command), fall back to
      // org-wide categories so reporters can still select an incident type.
      // Admins should add categories specifically for this command in Field Admin.
      if (scoped.length > 0) return scoped;
    }
    return db.select().from(incidentCategories).where(eq(incidentCategories.organizationId, orgId));
  }

  async getCategory(id: number, orgId: string): Promise<Category | undefined> {
    const [cat] = await db.select().from(incidentCategories).where(and(eq(incidentCategories.id, id), eq(incidentCategories.organizationId, orgId)));
    return cat;
  }

  async createCategory(category: InsertCategory, orgId: string): Promise<Category> {
    if (category.isOther) {
      await db.update(incidentCategories).set({ isOther: false }).where(and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.isOther, true)));
    }
    const [created] = await db.insert(incidentCategories).values({ ...category, organizationId: orgId }).returning();
    return created;
  }

  async updateCategory(id: number, category: Partial<InsertCategory>, orgId: string): Promise<Category | undefined> {
    if (category.isOther) {
      await db.update(incidentCategories).set({ isOther: false }).where(and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.isOther, true)));
    }
    const [updated] = await db.update(incidentCategories).set(category).where(and(eq(incidentCategories.id, id), eq(incidentCategories.organizationId, orgId))).returning();
    return updated;
  }

  async ensureOtherCategory(orgId: string, commandId?: number | null): Promise<Category> {
    return db.transaction(async (tx) => {
      // Strict per-Command isolation: an "Other" category in another Command
      // must not satisfy a lookup in this Command. Each Command gets its own.
      const whereClause = commandId != null
        ? and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.isOther, true), eq(incidentCategories.commandId, commandId))
        : and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.isOther, true), isNull(incidentCategories.commandId));
      const existing = await tx.select().from(incidentCategories).where(whereClause).for("update");
      if (existing.length > 0) return existing[0];
      const [created] = await tx.insert(incidentCategories).values({
        organizationId: orgId,
        name: "Other",
        color: "#6B7280",
        icon: "alert",
        isOther: true,
        commandId: commandId ?? null,
      }).returning();
      return created;
    });
  }

  async deleteCategory(id: number, orgId: string): Promise<boolean> {
    await db.delete(incidentCategories).where(and(eq(incidentCategories.id, id), eq(incidentCategories.organizationId, orgId)));
    return true;
  }

  // --- Incidents ---
  async getIncidents(orgId: string, restrictToLocationIds?: number[], commandFilter?: number[]): Promise<Incident[]> {
    const baseFilter = eq(incidents.organizationId, orgId);
    const locationClause = restrictToLocationIds && restrictToLocationIds.length > 0
      ? or(inArray(incidents.locationId, restrictToLocationIds), isNull(incidents.locationId))
      : undefined;
    // Command isolation: include incidents stamped with any accessible commandId,
    // plus legacy/null commandId rows (defensive — migration backfills these).
    const commandClause = commandFilter && commandFilter.length > 0
      ? inArray(incidents.commandId, commandFilter)
      : undefined;
    return db.select().from(incidents)
      .where(and(baseFilter, locationClause, commandClause))
      .orderBy(desc(incidents.createdAt));
  }

  async getIncident(id: number, orgId: string): Promise<Incident | undefined> {
    const [incident] = await db.select().from(incidents).where(and(eq(incidents.id, id), eq(incidents.organizationId, orgId)));
    return incident;
  }

  async getLiveIncidents(orgId: string, commandFilter?: number[]): Promise<LiveIncident[]> {
    const rows = await db
      .select({
        id: incidents.id,
        organizationId: incidents.organizationId,
        userId: incidents.userId,
        incidentDate: incidents.incidentDate,
        incidentTime: incidents.incidentTime,
        locationId: incidents.locationId,
        locationName: incidents.locationName,
        latitude: incidents.latitude,
        longitude: incidents.longitude,
        customMapId: incidents.customMapId,
        customMapX: incidents.customMapX,
        customMapY: incidents.customMapY,
        categoryId: incidents.categoryId,
        otherCategoryNote: incidents.otherCategoryNote,
        description: incidents.description,
        customFields: incidents.customFields,
        importBatchId: incidents.importBatchId,
        isLive: incidents.isLive,
        isEscalated: incidents.isEscalated,
        liveStartedAt: incidents.liveStartedAt,
        responderLat: incidents.responderLat,
        responderLng: incidents.responderLng,
        responderPositionUpdatedAt: incidents.responderPositionUpdatedAt,
        responderArrivedAt: incidents.responderArrivedAt,
        destinationName: incidents.destinationName,
        destinationLat: incidents.destinationLat,
        destinationLng: incidents.destinationLng,
        createdAt: incidents.createdAt,
        liveStartLat: incidents.liveStartLat,
        liveStartLng: incidents.liveStartLng,
        liveEndedAt: incidents.liveEndedAt,
        liveClosedManually: incidents.liveClosedManually,
        liveConvertLat: incidents.liveConvertLat,
        liveConvertLng: incidents.liveConvertLng,
        responderFirstName: users.firstName,
        responderLastName: users.lastName,
        categoryName: incidentCategories.name,
        categoryColor: incidentCategories.color,
        severity: incidents.severity,
        panicAcknowledgedAt: incidents.panicAcknowledgedAt,
        panicAcknowledgedByUserId: incidents.panicAcknowledgedByUserId,
        commandId: incidents.commandId,
        panicClosedAt: incidents.panicClosedAt,
      })
      .from(incidents)
      .leftJoin(users, eq(incidents.userId, users.id))
      .leftJoin(incidentCategories, eq(incidents.categoryId, incidentCategories.id))
      .where(and(
        eq(incidents.organizationId, orgId),
        eq(incidents.isLive, true),
        commandFilter && commandFilter.length > 0
          ? inArray(incidents.commandId, commandFilter)
          : undefined,
      ))
      .orderBy(desc(incidents.createdAt));

    if (rows.length === 0) return [];

    // Fetch active responders for all live incidents in one query
    const incidentIds = rows.map(r => r.id);
    const responderRows = await db
      .select({
        id: liveResponders.id,
        incidentId: liveResponders.incidentId,
        userId: liveResponders.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        lastLat: liveResponders.lastLat,
        lastLng: liveResponders.lastLng,
        lastPositionAt: liveResponders.lastPositionAt,
        joinedAt: liveResponders.joinedAt,
        arrivedAt: liveResponders.arrivedAt,
        arrivalNote: liveResponders.arrivalNote,
        destinationLat: liveResponders.destinationLat,
        destinationLng: liveResponders.destinationLng,
        destinationName: liveResponders.destinationName,
      })
      .from(liveResponders)
      .innerJoin(users, eq(liveResponders.userId, users.id))
      .where(and(
        eq(liveResponders.organizationId, orgId),
        inArray(liveResponders.incidentId, incidentIds),
        isNull(liveResponders.leftAt),
      ));

    // Group responders by incidentId
    const respondersByIncident = new Map<number, LiveResponderSummary[]>();
    for (const r of responderRows) {
      if (!respondersByIncident.has(r.incidentId)) respondersByIncident.set(r.incidentId, []);
      respondersByIncident.get(r.incidentId)!.push({
        id: r.id,
        userId: r.userId,
        firstName: r.firstName,
        lastName: r.lastName,
        lastLat: r.lastLat,
        lastLng: r.lastLng,
        lastPositionAt: r.lastPositionAt ? r.lastPositionAt.toISOString() : null,
        joinedAt: r.joinedAt.toISOString(),
        arrivedAt: r.arrivedAt ? r.arrivedAt.toISOString() : null,
        arrivalNote: r.arrivalNote ?? null,
        destinationLat: r.destinationLat ?? null,
        destinationLng: r.destinationLng ?? null,
        destinationName: r.destinationName ?? null,
      });
    }

    return rows.map(r => ({
      // Explicit field mapping — avoids unknown cast, stays type-safe
      id: r.id,
      organizationId: r.organizationId,
      userId: r.userId,
      incidentDate: r.incidentDate,
      incidentTime: r.incidentTime,
      locationId: r.locationId,
      locationName: r.locationName,
      latitude: r.latitude,
      longitude: r.longitude,
      customMapId: r.customMapId,
      customMapX: r.customMapX,
      customMapY: r.customMapY,
      categoryId: r.categoryId,
      otherCategoryNote: r.otherCategoryNote,
      description: r.description,
      customFields: r.customFields,
      importBatchId: r.importBatchId,
      isLive: r.isLive,
      isEscalated: r.isEscalated,
      liveStartedAt: r.liveStartedAt,
      responderLat: r.responderLat,
      responderLng: r.responderLng,
      responderPositionUpdatedAt: r.responderPositionUpdatedAt,
      responderArrivedAt: r.responderArrivedAt,
      destinationName: r.destinationName,
      destinationLat: r.destinationLat,
      destinationLng: r.destinationLng,
      createdAt: r.createdAt,
      liveStartLat: r.liveStartLat,
      liveStartLng: r.liveStartLng,
      liveEndedAt: r.liveEndedAt,
      liveClosedManually: r.liveClosedManually,
      liveConvertLat: r.liveConvertLat,
      liveConvertLng: r.liveConvertLng,
      // Joined fields
      responderFirstName: r.responderFirstName ?? null,
      responderLastName: r.responderLastName ?? null,
      categoryName: r.categoryName ?? null,
      categoryColor: r.categoryColor ?? null,
      severity: r.severity ?? null,
      panicAcknowledgedAt: r.panicAcknowledgedAt ?? null,
      panicAcknowledgedByUserId: r.panicAcknowledgedByUserId ?? null,
      commandId: r.commandId ?? null,
      panicClosedAt: r.panicClosedAt ?? null,
      responders: respondersByIncident.get(r.id) ?? [],
    }));
  }

  // --- Live Responders ---
  async joinLiveIncident(incidentId: number, orgId: string, userId: string): Promise<LiveResponder> {
    // If there's an existing active row for this user+incident, return it
    const existing = await db.select().from(liveResponders)
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
    if (existing.length > 0) return existing[0];
    const [created] = await db.insert(liveResponders).values({
      incidentId,
      organizationId: orgId,
      userId,
    }).returning();
    return created;
  }

  async recordJoinerArrival(incidentId: number, orgId: string, userId: string, arrivedAt: Date, arrivalNote: string | null): Promise<void> {
    await db.update(liveResponders)
      .set({ arrivedAt, arrivalNote })
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
  }

  async leaveLiveIncident(incidentId: number, orgId: string, userId: string): Promise<void> {
    await db.update(liveResponders)
      .set({ leftAt: new Date() })
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
  }

  async updateLiveResponderPosition(incidentId: number, orgId: string, userId: string, lat: number, lng: number): Promise<void> {
    await db.update(liveResponders)
      .set({ lastLat: lat, lastLng: lng, lastPositionAt: new Date() })
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
  }

  async updateLiveResponderDestination(incidentId: number, orgId: string, userId: string, lat: number, lng: number, name: string): Promise<void> {
    await db.update(liveResponders)
      .set({ destinationLat: lat, destinationLng: lng, destinationName: name })
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
  }

  async getActiveLiveResponders(incidentId: number, orgId: string): Promise<Array<LiveResponder & { firstName: string; lastName: string }>> {
    const rows = await db
      .select({
        id: liveResponders.id,
        incidentId: liveResponders.incidentId,
        organizationId: liveResponders.organizationId,
        userId: liveResponders.userId,
        joinedAt: liveResponders.joinedAt,
        leftAt: liveResponders.leftAt,
        lastLat: liveResponders.lastLat,
        lastLng: liveResponders.lastLng,
        lastPositionAt: liveResponders.lastPositionAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(liveResponders)
      .innerJoin(users, eq(liveResponders.userId, users.id))
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        isNull(liveResponders.leftAt),
      ));
    return rows as Array<LiveResponder & { firstName: string; lastName: string }>;
  }

  async getIncidentResponders(incidentId: number, orgId: string): Promise<Array<LiveResponder & { firstName: string; lastName: string }>> {
    const rows = await db
      .select({
        id: liveResponders.id,
        incidentId: liveResponders.incidentId,
        organizationId: liveResponders.organizationId,
        userId: liveResponders.userId,
        joinedAt: liveResponders.joinedAt,
        leftAt: liveResponders.leftAt,
        lastLat: liveResponders.lastLat,
        lastLng: liveResponders.lastLng,
        lastPositionAt: liveResponders.lastPositionAt,
        arrivedAt: liveResponders.arrivedAt,
        arrivalNote: liveResponders.arrivalNote,
        destinationLat: liveResponders.destinationLat,
        destinationLng: liveResponders.destinationLng,
        destinationName: liveResponders.destinationName,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(liveResponders)
      .innerJoin(users, eq(liveResponders.userId, users.id))
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
      ))
      .orderBy(liveResponders.joinedAt);
    return rows as Array<LiveResponder & { firstName: string; lastName: string }>;
  }

  async getIncidentsByResponder(userId: string, orgId: string): Promise<Array<{ incidentId: number; joinedAt: Date; leftAt: Date | null; arrivedAt: Date | null; arrivalNote: string | null; incidentDate: string; incidentTime: string; categoryId: number | null; description: string | null; creatorFirstName: string | null; creatorLastName: string | null }>> {
    const creatorAlias = alias(users, "creator");
    const rows = await db
      .select({
        incidentId: liveResponders.incidentId,
        joinedAt: liveResponders.joinedAt,
        leftAt: liveResponders.leftAt,
        arrivedAt: liveResponders.arrivedAt,
        arrivalNote: liveResponders.arrivalNote,
        incidentDate: incidents.incidentDate,
        incidentTime: incidents.incidentTime,
        categoryId: incidents.categoryId,
        description: incidents.description,
        creatorFirstName: creatorAlias.firstName,
        creatorLastName: creatorAlias.lastName,
      })
      .from(liveResponders)
      .innerJoin(incidents, eq(liveResponders.incidentId, incidents.id))
      .leftJoin(creatorAlias, eq(incidents.userId, creatorAlias.id))
      .where(and(
        eq(liveResponders.userId, userId),
        eq(liveResponders.organizationId, orgId),
      ))
      .orderBy(desc(liveResponders.joinedAt));
    return rows;
  }

  async closeAllLiveResponders(incidentId: number, orgId: string): Promise<void> {
    await db.update(liveResponders)
      .set({ leftAt: new Date() })
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        isNull(liveResponders.leftAt),
      ));
  }

  async getActiveLiveResponderByUser(incidentId: number, orgId: string, userId: string): Promise<LiveResponder | undefined> {
    const [row] = await db.select().from(liveResponders)
      .where(and(
        eq(liveResponders.incidentId, incidentId),
        eq(liveResponders.organizationId, orgId),
        eq(liveResponders.userId, userId),
        isNull(liveResponders.leftAt),
      ));
    return row;
  }

  async ensureLiveIncidentCategory(orgId: string, commandId?: number | null): Promise<Category> {
    return db.transaction(async (tx) => {
      // Strict per-Command isolation — each Command owns its "Live Incident" row.
      const whereClause = commandId != null
        ? and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.name, "Live Incident"), eq(incidentCategories.commandId, commandId))
        : and(eq(incidentCategories.organizationId, orgId), eq(incidentCategories.name, "Live Incident"), isNull(incidentCategories.commandId));
      const existing = await tx.select().from(incidentCategories).where(whereClause).for("update");
      if (existing.length > 0) return existing[0];
      const [created] = await tx.insert(incidentCategories).values({
        organizationId: orgId,
        name: "Live Incident",
        color: "#22c55e",
        icon: "alert",
        isOther: false,
        isSystem: true,
        commandId: commandId ?? null,
      }).returning();
      return created;
    });
  }

  async createIncident(incident: InsertIncident, orgId: string, userId?: string): Promise<Incident> {
    const [created] = await db.insert(incidents).values({ ...incident, organizationId: orgId, userId: userId ?? null }).returning();
    return created;
  }

  async updateIncident(id: number, incident: Partial<InsertIncident>, orgId: string): Promise<Incident | undefined> {
    const [updated] = await db.update(incidents).set(incident).where(and(eq(incidents.id, id), eq(incidents.organizationId, orgId))).returning();
    return updated;
  }

  async escalateIncident(id: number, orgId: string): Promise<Incident | undefined> {
    const [updated] = await db.update(incidents)
      .set({ isEscalated: true })
      .where(and(eq(incidents.id, id), eq(incidents.organizationId, orgId)))
      .returning();
    return updated;
  }

  async deleteIncident(id: number, orgId: string): Promise<boolean> {
    await db.delete(incidents).where(and(eq(incidents.id, id), eq(incidents.organizationId, orgId)));
    return true;
  }

  async getIncidentStats(orgId: string, startDate?: string, endDate?: string, restrictToLocationIds?: number[], commandFilter?: number[]): Promise<any> {
    const orgFilter = eq(incidents.organizationId, orgId);
    const locationFilter = restrictToLocationIds && restrictToLocationIds.length > 0
      ? or(inArray(incidents.locationId, restrictToLocationIds), isNull(incidents.locationId))
      : undefined;
    const commandFilterClause = commandFilter && commandFilter.length > 0
      ? inArray(incidents.commandId, commandFilter)
      : undefined;
    const dateFilter = and(
      orgFilter,
      locationFilter,
      commandFilterClause,
      isNull(incidents.liveStartedAt),
      startDate ? gte(incidents.incidentDate, startDate) : undefined,
      endDate ? lte(incidents.incidentDate, endDate) : undefined,
    );

    const totalResult = await db.select({ count: sql<number>`count(*)` }).from(incidents).where(dateFilter);
    const total = Number(totalResult[0].count);

    const byCategory = await db
      .select({
        categoryId: incidents.categoryId,
        categoryName: incidentCategories.name,
        color: incidentCategories.color,
        count: sql<number>`count(*)`,
      })
      .from(incidents)
      .leftJoin(incidentCategories, eq(incidents.categoryId, incidentCategories.id))
      .where(dateFilter)
      .groupBy(incidents.categoryId, incidentCategories.name, incidentCategories.color);

    const byDate = await db
      .select({ date: incidents.incidentDate, count: sql<number>`count(*)` })
      .from(incidents)
      .where(dateFilter)
      .groupBy(incidents.incidentDate)
      .orderBy(incidents.incidentDate);

    const byTime = await db
      .select({
        hour: sql<number>`extract(hour from incident_time::time)::int`,
        count: sql<number>`count(*)`,
      })
      .from(incidents)
      .where(dateFilter)
      .groupBy(sql`extract(hour from incident_time::time)`)
      .orderBy(sql`extract(hour from incident_time::time)`);

    const byLocation = await db
      .select({ locationName: incidents.locationName, count: sql<number>`count(*)` })
      .from(incidents)
      .where(and(
        dateFilter,
        or(isNull(incidents.locationName), ne(incidents.locationName, "Live Incident")),
        or(isNotNull(incidents.locationName), isNotNull(incidents.locationId)),
      ))
      .groupBy(incidents.locationName)
      .orderBy(sql`count(*) desc`);

    const liveCountResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(incidents)
      .where(and(dateFilter, isNotNull(incidents.liveStartedAt)));
    const liveCount = Number(liveCountResult[0].count);

    const avgResponseResult = await db
      .select({ avgMinutes: sql<number>`avg(extract(epoch from (responder_arrived_at - live_started_at)) / 60)` })
      .from(incidents)
      .where(and(dateFilter, isNotNull(incidents.liveStartedAt), isNotNull(incidents.responderArrivedAt)));
    const avgResponseTimeMinutes = avgResponseResult[0]?.avgMinutes != null
      ? Math.round(Number(avgResponseResult[0].avgMinutes))
      : null;

    return {
      total,
      byCategory: byCategory.map(c => ({ ...c, count: Number(c.count) })),
      byDate: byDate.map(d => ({ date: d.date, count: Number(d.count) })),
      byTime: byTime.map(t => ({ hour: Number(t.hour), count: Number(t.count) })),
      byLocation: byLocation.map(l => ({ locationName: l.locationName || "Unknown", count: Number(l.count) })),
      liveCount,
      avgResponseTimeMinutes,
    };
  }

  // --- User Location Assignments ---
  async getUserLocationAssignments(userId: string, orgId: string): Promise<number[]> {
    const rows = await db.select({ locationId: userLocationAssignments.locationId })
      .from(userLocationAssignments)
      .where(and(eq(userLocationAssignments.userId, userId), eq(userLocationAssignments.organizationId, orgId)));
    return rows.map(r => r.locationId);
  }

  async setUserLocationAssignments(userId: string, locationIds: number[], orgId: string): Promise<void> {
    await db.delete(userLocationAssignments)
      .where(and(eq(userLocationAssignments.userId, userId), eq(userLocationAssignments.organizationId, orgId)));
    if (locationIds.length > 0) {
      await db.insert(userLocationAssignments).values(
        locationIds.map(locationId => ({ userId, locationId, organizationId: orgId }))
      );
    }
  }

  // --- Form Fields ---
  async getFormFields(orgId: string, commandFilter?: number[]): Promise<FormField[]> {
    if (commandFilter && commandFilter.length > 0) {
      const scoped = await db.select().from(formFields).where(and(
        eq(formFields.organizationId, orgId),
        inArray(formFields.commandId, commandFilter),
      )).orderBy(asc(formFields.sortOrder));
      // Form-field visibility config is stored org-wide (UNIQUE(fieldKey, orgId) prevents
      // per-command rows). If the command-scoped query returns nothing (e.g. a newly created
      // command whose form_fields weren't seeded yet), fall back to the org-wide set so
      // reporters always see the full incident form rather than a blank Evidence-only dialog.
      if (scoped.length > 0) return scoped;
    }
    return db.select().from(formFields).where(eq(formFields.organizationId, orgId)).orderBy(asc(formFields.sortOrder));
  }

  async getFormField(id: number, orgId: string): Promise<FormField | undefined> {
    const [field] = await db.select().from(formFields).where(and(eq(formFields.id, id), eq(formFields.organizationId, orgId)));
    return field;
  }

  async createFormField(field: InsertFormField, orgId: string): Promise<FormField> {
    const [created] = await db.insert(formFields).values({ ...field, organizationId: orgId }).returning();
    return created;
  }

  async updateFormField(id: number, field: Partial<InsertFormField>, orgId: string): Promise<FormField | undefined> {
    const [updated] = await db.update(formFields).set(field).where(and(eq(formFields.id, id), eq(formFields.organizationId, orgId))).returning();
    return updated;
  }

  async deleteFormField(id: number, orgId: string): Promise<boolean> {
    await db.delete(formFields).where(and(eq(formFields.id, id), eq(formFields.organizationId, orgId)));
    return true;
  }

  // --- Attachments ---
  async getAttachmentsByIncident(incidentId: number, orgId: string): Promise<AttachmentWithUploader[]> {
    return db.select({
      id: incidentAttachments.id,
      incidentId: incidentAttachments.incidentId,
      organizationId: incidentAttachments.organizationId,
      uploadedByUserId: incidentAttachments.uploadedByUserId,
      evidencePhase: incidentAttachments.evidencePhase,
      url: incidentAttachments.url,
      filename: incidentAttachments.filename,
      mimeType: incidentAttachments.mimeType,
      createdAt: incidentAttachments.createdAt,
      uploadedByFirstName: users.firstName,
      uploadedByLastName: users.lastName,
    })
      .from(incidentAttachments)
      .leftJoin(users, eq(incidentAttachments.uploadedByUserId, users.id))
      .where(and(eq(incidentAttachments.incidentId, incidentId), eq(incidentAttachments.organizationId, orgId)))
      .orderBy(asc(incidentAttachments.createdAt));
  }

  async getAttachment(id: number, orgId: string): Promise<Attachment | undefined> {
    const [att] = await db.select().from(incidentAttachments)
      .where(and(eq(incidentAttachments.id, id), eq(incidentAttachments.organizationId, orgId)));
    return att;
  }

  async createAttachment(data: InsertAttachment & { uploadedByUserId?: string | null }): Promise<Attachment> {
    const [created] = await db.insert(incidentAttachments).values(data).returning();
    return created;
  }

  async deleteAttachment(id: number, orgId: string): Promise<boolean> {
    await db.delete(incidentAttachments).where(and(eq(incidentAttachments.id, id), eq(incidentAttachments.organizationId, orgId)));
    return true;
  }

  async getEvidenceNotesByIncident(incidentId: number, orgId: string): Promise<EvidenceNoteWithAuthor[]> {
    return db.select({
      id: incidentEvidenceNotes.id,
      incidentId: incidentEvidenceNotes.incidentId,
      organizationId: incidentEvidenceNotes.organizationId,
      authorUserId: incidentEvidenceNotes.authorUserId,
      evidencePhase: incidentEvidenceNotes.evidencePhase,
      body: incidentEvidenceNotes.body,
      createdAt: incidentEvidenceNotes.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
      .from(incidentEvidenceNotes)
      .leftJoin(users, eq(incidentEvidenceNotes.authorUserId, users.id))
      .where(and(eq(incidentEvidenceNotes.incidentId, incidentId), eq(incidentEvidenceNotes.organizationId, orgId)))
      .orderBy(asc(incidentEvidenceNotes.createdAt));
  }

  async getEvidenceNote(id: number, orgId: string): Promise<EvidenceNote | undefined> {
    const [note] = await db.select().from(incidentEvidenceNotes)
      .where(and(eq(incidentEvidenceNotes.id, id), eq(incidentEvidenceNotes.organizationId, orgId)));
    return note;
  }

  async createEvidenceNote(data: InsertEvidenceNote & { authorUserId?: string | null }): Promise<EvidenceNote> {
    const [created] = await db.insert(incidentEvidenceNotes).values(data).returning();
    return created;
  }

  async deleteEvidenceNote(id: number, orgId: string): Promise<boolean> {
    await db.delete(incidentEvidenceNotes).where(and(eq(incidentEvidenceNotes.id, id), eq(incidentEvidenceNotes.organizationId, orgId)));
    return true;
  }

  async getAttachmentCountsByOrg(orgId: string): Promise<Record<number, number>> {
    const rows = await db.select({
      incidentId: incidentAttachments.incidentId,
      count: sql<number>`count(*)`,
    }).from(incidentAttachments)
      .where(eq(incidentAttachments.organizationId, orgId))
      .groupBy(incidentAttachments.incidentId);
    const map: Record<number, number> = {};
    for (const r of rows) map[r.incidentId] = Number(r.count);
    return map;
  }

  // --- Custom Maps ---
  async getCustomMaps(orgId: string, commandFilter?: number[]): Promise<CustomMap[]> {
    if (commandFilter && commandFilter.length > 0) {
      return db.select().from(customMaps)
        .where(and(eq(customMaps.organizationId, orgId), inArray(customMaps.commandId, commandFilter)))
        .orderBy(asc(customMaps.sortOrder), asc(customMaps.id));
    }
    return db.select().from(customMaps)
      .where(eq(customMaps.organizationId, orgId))
      .orderBy(asc(customMaps.sortOrder), asc(customMaps.id));
  }

  async getCustomMap(id: number, orgId: string): Promise<CustomMap | undefined> {
    const [map] = await db.select().from(customMaps)
      .where(and(eq(customMaps.id, id), eq(customMaps.organizationId, orgId)));
    return map;
  }

  async createCustomMap(data: InsertCustomMap, orgId: string, commandId?: number | null): Promise<CustomMap> {
    const [created] = await db.insert(customMaps).values({ ...data, organizationId: orgId, commandId: commandId ?? null }).returning();
    return created;
  }

  async deleteCustomMap(id: number, orgId: string): Promise<boolean> {
    await db.transaction(async (tx) => {
      await tx.update(incidents)
        .set({ customMapX: null, customMapY: null })
        .where(and(eq(incidents.organizationId, orgId), eq(incidents.customMapId, id)));
      await tx.delete(customMaps).where(and(eq(customMaps.id, id), eq(customMaps.organizationId, orgId)));
    });
    return true;
  }

  // --- Audit Logs ---
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    // Drizzle's narrow `Record<string, {from: unknown; to: unknown}>` for the
    // JSONB column conflicts with our InsertAuditLog's optional `{from?, to?}`
    // — runtime payloads are identical, so widen via cast.
    const [created] = await db.insert(auditLogs).values(log as typeof auditLogs.$inferInsert).returning();
    return created;
  }

  async getAuditLogsByUser(userId: string, orgId: string, since?: Date): Promise<AuditLog[]> {
    const conditions = [eq(auditLogs.userId, userId), eq(auditLogs.organizationId, orgId)];
    if (since) conditions.push(gte(auditLogs.createdAt, since));
    return db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.createdAt));
  }

  async getRecentPanicAlerts(orgId: string, since: Date) {
    const panicker = alias(users, "panicker");
    const rows = await db
      .select({
        id: incidents.id,
        userId: incidents.userId,
        firstName: panicker.firstName,
        lastName: panicker.lastName,
        contactNumber: panicker.contactNumber,
        lat: sql<number | null>`coalesce(${incidents.latitude}, ${incidents.liveStartLat}, ${incidents.destinationLat})`.as("lat"),
        lng: sql<number | null>`coalesce(${incidents.longitude}, ${incidents.liveStartLng}, ${incidents.destinationLng})`.as("lng"),
        createdAt: incidents.createdAt,
        panicAcknowledgedAt: incidents.panicAcknowledgedAt,
        panicClosedAt: incidents.panicClosedAt,
      })
      .from(incidents)
      .innerJoin(incidentCategories, eq(incidents.categoryId, incidentCategories.id))
      .innerJoin(panicker, eq(incidents.userId, panicker.id))
      .where(
        and(
          eq(incidents.organizationId, orgId),
          eq(incidentCategories.name, "Panic"),
          gte(incidents.createdAt, since),
          isNull(incidents.panicClosedAt),
        )
      )
      .orderBy(desc(incidents.createdAt));
    if (rows.length === 0) return [];

    const ackRows = await db
      .select({
        incidentId: panicAcknowledgers.incidentId,
        userId: panicAcknowledgers.userId,
        acknowledgedAt: panicAcknowledgers.acknowledgedAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(panicAcknowledgers)
      .innerJoin(users, eq(panicAcknowledgers.userId, users.id))
      .where(and(
        eq(panicAcknowledgers.organizationId, orgId),
        inArray(panicAcknowledgers.incidentId, rows.map(r => r.id)),
      ))
      .orderBy(asc(panicAcknowledgers.acknowledgedAt));
    // Pull live_responders arrival timestamps for the same incidents so
    // the banner can show "on scene" vs "en route" per acknowledger.
    const responderRows = await db
      .select({
        incidentId: liveResponders.incidentId,
        userId: liveResponders.userId,
        arrivedAt: liveResponders.arrivedAt,
      })
      .from(liveResponders)
      .where(and(
        eq(liveResponders.organizationId, orgId),
        inArray(liveResponders.incidentId, rows.map(r => r.id)),
      ));
    const arrivalByIncidentUser = new Map<string, Date | null>();
    for (const r of responderRows) {
      arrivalByIncidentUser.set(`${r.incidentId}:${r.userId}`, r.arrivedAt);
    }
    const acksByIncident = new Map<number, Array<{ userId: string; firstName: string; lastName: string; acknowledgedAt: Date; arrivedAt: Date | null }>>();
    for (const a of ackRows) {
      if (!acksByIncident.has(a.incidentId)) acksByIncident.set(a.incidentId, []);
      acksByIncident.get(a.incidentId)!.push({
        userId: a.userId,
        firstName: a.firstName,
        lastName: a.lastName,
        acknowledgedAt: a.acknowledgedAt,
        arrivedAt: arrivalByIncidentUser.get(`${a.incidentId}:${a.userId}`) ?? null,
      });
    }
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      firstName: r.firstName,
      lastName: r.lastName,
      contactNumber: r.contactNumber ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      createdAt: r.createdAt,
      panicAcknowledgedAt: r.panicAcknowledgedAt ?? null,
      panicClosedAt: r.panicClosedAt ?? null,
      acknowledgedBy: acksByIncident.get(r.id) ?? [],
    }));
  }

  async acknowledgePanic(incidentId: number, orgId: string, acknowledgedByUserId: string): Promise<void> {
    // Per-user ack: idempotent insert into the join table.
    await db.insert(panicAcknowledgers)
      .values({ incidentId, organizationId: orgId, userId: acknowledgedByUserId })
      .onConflictDoNothing({ target: [panicAcknowledgers.incidentId, panicAcknowledgers.userId] });
    // Maintain legacy columns with the first-ack so existing queries (reminder loop,
    // historical reports) continue to work without rewrites. Use a single
    // conditional UPDATE so concurrent ackers cannot both overwrite the first
    // ack — only the row whose panic_acknowledged_at is still NULL is touched.
    await db.update(incidents)
      .set({ panicAcknowledgedAt: new Date(), panicAcknowledgedByUserId: acknowledgedByUserId })
      .where(and(
        eq(incidents.id, incidentId),
        eq(incidents.organizationId, orgId),
        isNull(incidents.panicAcknowledgedAt),
      ));
  }

  async closePanic(incidentId: number, orgId: string): Promise<void> {
    // Ends the panic AND the underlying live session in one atomic update,
    // and closes any active responders. Without this, a "closed" panic still
    // appears on /api/incidents/live (live monitor, dashboard map, joinable
    // list) because panic incidents are created with isLive=true.
    const now = new Date();
    await db.update(incidents)
      .set({
        panicClosedAt: now,
        isLive: false,
        liveEndedAt: now,
        liveClosedManually: true,
      })
      .where(and(eq(incidents.id, incidentId), eq(incidents.organizationId, orgId)));
    await this.closeAllLiveResponders(incidentId, orgId);
  }

  async getAllUnacknowledgedPanicsForReminder(): Promise<Array<{ id: number; organizationId: string; userId: string | null; firstName: string | null; lastName: string | null }>> {
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const panicker = alias(users, "panicker");
    return db
      .select({
        id: incidents.id,
        organizationId: incidents.organizationId,
        userId: incidents.userId,
        firstName: panicker.firstName,
        lastName: panicker.lastName,
      })
      .from(incidents)
      .innerJoin(incidentCategories, eq(incidents.categoryId, incidentCategories.id))
      .leftJoin(panicker, eq(incidents.userId, panicker.id))
      .where(
        and(
          eq(incidentCategories.name, "Panic"),
          gte(incidents.createdAt, since),
          isNull(incidents.panicAcknowledgedAt),
          isNull(incidents.panicClosedAt),
        )
      );
  }

  // --- Import Batches ---
  async createImportBatch(data: InsertImportBatch): Promise<ImportBatch> {
    // Cast: Drizzle's inferred type for the `errorSummary` JSONB column is too
    // narrow to match our InsertImportBatch shape (same runtime data).
    const [created] = await db.insert(importBatches).values(data as typeof importBatches.$inferInsert).returning();
    return created;
  }

  async getImportBatch(id: number, orgId: string): Promise<ImportBatch | undefined> {
    const [batch] = await db.select().from(importBatches)
      .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, orgId)));
    return batch;
  }

  async listImportBatches(orgId: string): Promise<ImportBatch[]> {
    return db.select().from(importBatches)
      .where(eq(importBatches.organizationId, orgId))
      .orderBy(desc(importBatches.createdAt));
  }

  async updateImportBatch(id: number, orgId: string, data: Partial<ImportBatch>): Promise<ImportBatch | undefined> {
    const [updated] = await db.update(importBatches).set(data)
      .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, orgId)))
      .returning();
    return updated;
  }

  async claimImportBatchForCommit(id: number, orgId: string): Promise<ImportBatch | undefined> {
    const [updated] = await db.update(importBatches)
      .set({ status: "processing" })
      .where(and(
        eq(importBatches.id, id),
        eq(importBatches.organizationId, orgId),
        inArray(importBatches.status, ["pending", "mapping", "validating", "failed"]),
      ))
      .returning();
    return updated;
  }

  async deleteImportBatchAndIncidents(id: number, orgId: string): Promise<{ deletedIncidents: number; deletedCategoryIds: number[]; deletedLocationIds: number[] }> {
    const batch = await this.getImportBatch(id, orgId);
    if (!batch) return { deletedIncidents: 0, deletedCategoryIds: [], deletedLocationIds: [] };

    return await db.transaction(async (tx) => {
      const deletedRows = await tx.delete(incidents)
        .where(and(eq(incidents.importBatchId, id), eq(incidents.organizationId, orgId)))
        .returning({ id: incidents.id });
      const deletedIncidents = deletedRows.length;

      const deletedCategoryIds: number[] = [];
      const deletedLocationIds: number[] = [];

      // Try to delete categories created by this batch only if no other incidents reference them
      if (batch.createdCategoryIds && batch.createdCategoryIds.length > 0) {
        for (const catId of batch.createdCategoryIds) {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)` })
            .from(incidents)
            .where(and(eq(incidents.categoryId, catId), eq(incidents.organizationId, orgId)));
          if (Number(count) === 0) {
            await tx.delete(incidentCategories)
              .where(and(eq(incidentCategories.id, catId), eq(incidentCategories.organizationId, orgId)));
            deletedCategoryIds.push(catId);
          }
        }
      }

      if (batch.createdLocationIds && batch.createdLocationIds.length > 0) {
        for (const locId of batch.createdLocationIds) {
          const [{ count }] = await tx.select({ count: sql<number>`count(*)` })
            .from(incidents)
            .where(and(eq(incidents.locationId, locId), eq(incidents.organizationId, orgId)));
          if (Number(count) === 0) {
            await tx.delete(locations)
              .where(and(eq(locations.id, locId), eq(locations.organizationId, orgId)));
            deletedLocationIds.push(locId);
          }
        }
      }

      await tx.update(importBatches)
        .set({ status: "rolled_back", completedAt: new Date() })
        .where(eq(importBatches.id, id));

      return { deletedIncidents, deletedCategoryIds, deletedLocationIds };
    });
  }

  async bulkCreateIncidents(rows: (InsertIncident & { organizationId: string; importBatchId: number })[]): Promise<number> {
    if (rows.length === 0) return 0;
    const CHUNK = 500;
    let total = 0;
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const inserted = await tx.insert(incidents).values(chunk).returning({ id: incidents.id });
        total += inserted.length;
      }
    });
    return total;
  }

  // --- Push Subscriptions ---
  async upsertPushSubscription(orgId: string, userId: string, sub: { endpoint: string; p256dh: string; auth: string }): Promise<{ wasAlreadyRegistered: boolean }> {
    const existing = await db.select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub.endpoint))
      .limit(1);
    const wasAlreadyRegistered = existing.length > 0;
    await db.insert(pushSubscriptions).values({
      organizationId: orgId,
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    }).onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: sub.p256dh, auth: sub.auth, userId, organizationId: orgId },
    });
    return { wasAlreadyRegistered };
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async deletePushSubscriptionByUser(endpoint: string, userId: string): Promise<void> {
    await db.delete(pushSubscriptions).where(
      and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId))
    );
  }

  async deleteAllPushSubscriptionsByUser(userId: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  private async fcmUserIdsInOrg(orgId: string): Promise<Set<string>> {
    const rows = await db
      .selectDistinct({ userId: fcmTokens.userId })
      .from(fcmTokens)
      .where(eq(fcmTokens.organizationId, orgId));
    return new Set(rows.map((r) => r.userId));
  }

  async getPushSubscriptionsByOrg(orgId: string, excludeUserId?: string, roles?: string[], commandIds?: number[]): Promise<Array<{ endpoint: string; p256dh: string; auth: string; userId: string }>> {
    const conditions: ReturnType<typeof and>[] = [
      eq(pushSubscriptions.organizationId, orgId),
      eq(users.isActive, true),
    ];
    if (excludeUserId) conditions.push(ne(pushSubscriptions.userId, excludeUserId));
    if (roles && roles.length > 0) conditions.push(inArray(users.role, roles));
    if (commandIds && commandIds.length > 0) {
      // Restrict to users who are members of at least one of the specified Commands.
      // This ensures live-incident and severity alerts only reach users in the same Command.
      const memberSubquery = db
        .selectDistinct({ userId: commandUsers.userId })
        .from(commandUsers)
        .where(inArray(commandUsers.commandId, commandIds));
      conditions.push(inArray(pushSubscriptions.userId, memberSubquery));
    }
    const subs = await db.select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
      userId: pushSubscriptions.userId,
    })
      .from(pushSubscriptions)
      .innerJoin(users, eq(pushSubscriptions.userId, users.id))
      .where(and(...conditions));
    const nativeUserIds = await this.fcmUserIdsInOrg(orgId);
    return subs.filter((s) => !nativeUserIds.has(s.userId));
  }

  async countLiveIncidents(orgId: string): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` })
      .from(incidents)
      .where(and(eq(incidents.organizationId, orgId), eq(incidents.isLive, true)));
    return Number(result.count);
  }

  async getAllLiveIncidentsForStaleCheck(): Promise<Array<{ id: number; organizationId: string; userId: string | null; responderPositionUpdatedAt: Date | null; liveStartedAt: Date | null; responderFirstName: string | null; responderLastName: string | null }>> {
    const rows = await db
      .select({
        id: incidents.id,
        organizationId: incidents.organizationId,
        userId: incidents.userId,
        responderPositionUpdatedAt: incidents.responderPositionUpdatedAt,
        liveStartedAt: incidents.liveStartedAt,
        responderFirstName: users.firstName,
        responderLastName: users.lastName,
      })
      .from(incidents)
      .leftJoin(users, eq(incidents.userId, users.id))
      .where(eq(incidents.isLive, true));
    return rows.map(r => ({
      id: r.id,
      organizationId: r.organizationId,
      userId: r.userId,
      responderPositionUpdatedAt: r.responderPositionUpdatedAt,
      liveStartedAt: r.liveStartedAt,
      responderFirstName: r.responderFirstName ?? null,
      responderLastName: r.responderLastName ?? null,
    }));
  }

  async createNotificationLog(data: InsertNotificationLog): Promise<NotificationLog> {
    const [created] = await db.insert(notificationLogs).values(data).returning();
    return created;
  }

  async getNotificationLogsByUser(userId: string, orgId: string, since?: Date): Promise<NotificationLog[]> {
    const conditions = [
      eq(notificationLogs.userId, userId),
      eq(notificationLogs.organizationId, orgId),
    ];
    if (since) conditions.push(gte(notificationLogs.createdAt, since));
    return db.select().from(notificationLogs)
      .where(and(...conditions))
      .orderBy(desc(notificationLogs.createdAt));
  }

  async hasNotificationLogWithUrl(orgId: string, userId: string, url: string): Promise<boolean> {
    const [row] = await db.select({ id: notificationLogs.id })
      .from(notificationLogs)
      .where(and(
        eq(notificationLogs.organizationId, orgId),
        eq(notificationLogs.userId, userId),
        eq(notificationLogs.url, url),
      ))
      .limit(1);
    return !!row;
  }

  async deleteNotificationLogsByUserAndUrl(orgId: string, userId: string, url: string): Promise<void> {
    await db.delete(notificationLogs).where(and(
      eq(notificationLogs.organizationId, orgId),
      eq(notificationLogs.userId, userId),
      eq(notificationLogs.url, url),
    ));
  }

  async getPushSubscriptionsByUser(userId: string): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
    const native = await this.getFcmTokensByUser(userId);
    if (native.length > 0) return [];
    return db.select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  }

  async getOrgPushSubscribedUserIds(orgId: string): Promise<Set<string>> {
    const byUser = await this.getOrgPushRegistrationByUser(orgId);
    return new Set([...byUser.entries()].filter(([, r]) => r.fcm || r.web).map(([id]) => id));
  }

  async getOrgPushRegistrationByUser(orgId: string): Promise<Map<string, { fcm: boolean; web: boolean }>> {
    const [webRows, fcmRows] = await Promise.all([
      db.selectDistinct({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .innerJoin(users, eq(pushSubscriptions.userId, users.id))
        .where(eq(users.organizationId, orgId)),
      db.selectDistinct({ userId: fcmTokens.userId })
        .from(fcmTokens)
        .innerJoin(users, eq(fcmTokens.userId, users.id))
        .where(eq(users.organizationId, orgId)),
    ]);
    const map = new Map<string, { fcm: boolean; web: boolean }>();
    for (const r of webRows) {
      const cur = map.get(r.userId) ?? { fcm: false, web: false };
      cur.web = true;
      map.set(r.userId, cur);
    }
    for (const r of fcmRows) {
      const cur = map.get(r.userId) ?? { fcm: false, web: false };
      cur.fcm = true;
      map.set(r.userId, cur);
    }
    return map;
  }

  // --- FCM Tokens ---
  async upsertFcmToken(orgId: string, userId: string, token: string): Promise<void> {
    await db.insert(fcmTokens).values({ organizationId: orgId, userId, token })
      .onConflictDoUpdate({ target: fcmTokens.token, set: { userId, organizationId: orgId } });
  }

  async deleteFcmToken(token: string): Promise<void> {
    await db.delete(fcmTokens).where(eq(fcmTokens.token, token));
  }

  async getFcmTokensByOrg(orgId: string, excludeUserId?: string, roles?: string[], commandIds?: number[]): Promise<Array<{ token: string; userId: string }>> {
    const conditions: ReturnType<typeof and>[] = [
      eq(fcmTokens.organizationId, orgId),
      eq(users.isActive, true),
    ];
    if (excludeUserId) conditions.push(ne(fcmTokens.userId, excludeUserId));
    if (roles && roles.length > 0) conditions.push(inArray(users.role, roles));
    if (commandIds && commandIds.length > 0) {
      const memberSubquery = db
        .selectDistinct({ userId: commandUsers.userId })
        .from(commandUsers)
        .where(inArray(commandUsers.commandId, commandIds));
      conditions.push(inArray(fcmTokens.userId, memberSubquery));
    }
    return db.select({ token: fcmTokens.token, userId: fcmTokens.userId })
      .from(fcmTokens)
      .innerJoin(users, eq(fcmTokens.userId, users.id))
      .where(and(...conditions));
  }

  async getUserIdsInCommands(orgId: string, commandIds: number[]): Promise<Set<string>> {
    if (commandIds.length === 0) return new Set();
    const rows = await db
      .selectDistinct({ userId: commandUsers.userId })
      .from(commandUsers)
      .where(and(eq(commandUsers.organizationId, orgId), inArray(commandUsers.commandId, commandIds)));
    return new Set(rows.map((r) => r.userId));
  }

  async getFcmTokensByUser(userId: string): Promise<Array<{ token: string }>> {
    return db.select({ token: fcmTokens.token }).from(fcmTokens).where(eq(fcmTokens.userId, userId));
  }

  // --- Chat ---
  async getChatMessages(orgId: string, userId: string, opts: { type: 'group'; limit: number; before?: number } | { type: 'dm'; withUserId: string; limit: number; before?: number }): Promise<Array<ChatMessage & { senderFirstName: string; senderLastName: string; senderAvatarUrl: string | null }>> {
    const senderAlias = alias(users, "sender");
    let threadFilter;
    if (opts.type === 'group') {
      threadFilter = and(eq(chatMessages.organizationId, orgId), isNull(chatMessages.recipientId));
    } else {
      threadFilter = and(
        eq(chatMessages.organizationId, orgId),
        isNotNull(chatMessages.recipientId),
        or(
          and(eq(chatMessages.senderId, userId), eq(chatMessages.recipientId, opts.withUserId)),
          and(eq(chatMessages.senderId, opts.withUserId), eq(chatMessages.recipientId, userId)),
        ),
      );
    }
    const beforeFilter = opts.before ? sql`${chatMessages.id} < ${opts.before}` : undefined;
    const where = and(threadFilter, beforeFilter);

    const rows = await db
      .select({
        id: chatMessages.id,
        organizationId: chatMessages.organizationId,
        senderId: chatMessages.senderId,
        recipientId: chatMessages.recipientId,
        content: chatMessages.content,
        createdAt: chatMessages.createdAt,
        senderFirstName: senderAlias.firstName,
        senderLastName: senderAlias.lastName,
        senderAvatarUrl: senderAlias.avatarUrl,
      })
      .from(chatMessages)
      .innerJoin(senderAlias, eq(chatMessages.senderId, senderAlias.id))
      .where(where)
      .orderBy(desc(chatMessages.id))
      .limit(opts.limit);

    return rows.map(r => ({ ...r, senderAvatarUrl: r.senderAvatarUrl ?? null })).reverse();
  }

  async sendChatMessage(orgId: string, senderId: string, recipientId: string | null, content: string): Promise<ChatMessage & { senderFirstName: string; senderLastName: string; senderAvatarUrl: string | null }> {
    const [msg] = await db.insert(chatMessages).values({ organizationId: orgId, senderId, recipientId, content }).returning();
    const sender = await this.getUserById(senderId);
    return {
      ...msg,
      senderFirstName: sender?.firstName ?? "",
      senderLastName: sender?.lastName ?? "",
      senderAvatarUrl: sender?.avatarUrl ?? null,
    };
  }

  async getChatMessageById(id: number, orgId: string): Promise<ChatMessage | undefined> {
    const [msg] = await db.select().from(chatMessages).where(and(eq(chatMessages.id, id), eq(chatMessages.organizationId, orgId)));
    return msg;
  }

  async deleteChatMessage(id: number, orgId: string): Promise<boolean> {
    const deleted = await db.delete(chatMessages).where(and(eq(chatMessages.id, id), eq(chatMessages.organizationId, orgId))).returning({ id: chatMessages.id });
    return deleted.length > 0;
  }

  async clearGroupChatMessages(orgId: string): Promise<number> {
    const deleted = await db.delete(chatMessages).where(and(eq(chatMessages.organizationId, orgId), isNull(chatMessages.recipientId))).returning({ id: chatMessages.id });
    return deleted.length;
  }

  async getChatConversations(orgId: string, userId: string): Promise<Array<{ recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; recipientAvatarUrl: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number }>> {
    // Group thread: last message + unread count
    const [groupRead] = await db.select({ lastReadAt: chatReads.lastReadAt })
      .from(chatReads)
      .where(and(eq(chatReads.userId, userId), eq(chatReads.organizationId, orgId), isNull(chatReads.recipientId)));
    const groupLastReadAt = groupRead?.lastReadAt ?? new Date(0);

    const [lastGroupMsg] = await db.select({ content: chatMessages.content, createdAt: chatMessages.createdAt })
      .from(chatMessages)
      .where(and(eq(chatMessages.organizationId, orgId), isNull(chatMessages.recipientId)))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);

    const [groupUnreadRow] = await db.select({ cnt: sql<number>`count(*)` })
      .from(chatMessages)
      .where(and(
        eq(chatMessages.organizationId, orgId),
        isNull(chatMessages.recipientId),
        gt(chatMessages.createdAt, groupLastReadAt),
        ne(chatMessages.senderId, userId),
      ));

    // DM partners: all users this user has exchanged messages with
    const dmRows = await db.selectDistinct({
      partnerId: sql<string>`CASE WHEN sender_id = ${userId} THEN recipient_id ELSE sender_id END`,
    })
      .from(chatMessages)
      .where(and(
        eq(chatMessages.organizationId, orgId),
        isNotNull(chatMessages.recipientId),
        or(eq(chatMessages.senderId, userId), eq(chatMessages.recipientId, userId)),
      ));

    const partnerIds = dmRows.map(r => r.partnerId).filter(Boolean) as string[];

    const results: Array<{ recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; recipientAvatarUrl: string | null; lastMessage: string | null; lastMessageAt: string | null; unreadCount: number }> = [
      {
        recipientId: null,
        recipientFirstName: null,
        recipientLastName: null,
        recipientAvatarUrl: null,
        lastMessage: lastGroupMsg?.content ?? null,
        lastMessageAt: lastGroupMsg?.createdAt?.toISOString() ?? null,
        unreadCount: Number(groupUnreadRow?.cnt ?? 0),
      },
    ];

    for (const partnerId of partnerIds) {
      const partner = await this.getUserById(partnerId);
      if (!partner) continue;

      const [dmReadRow] = await db.select({ lastReadAt: chatReads.lastReadAt })
        .from(chatReads)
        .where(and(eq(chatReads.userId, userId), eq(chatReads.organizationId, orgId), eq(chatReads.recipientId, partnerId)));
      const dmLastReadAt = dmReadRow?.lastReadAt ?? new Date(0);

      const [lastDmMsg] = await db.select({ content: chatMessages.content, createdAt: chatMessages.createdAt })
        .from(chatMessages)
        .where(and(
          eq(chatMessages.organizationId, orgId),
          isNotNull(chatMessages.recipientId),
          or(
            and(eq(chatMessages.senderId, userId), eq(chatMessages.recipientId, partnerId)),
            and(eq(chatMessages.senderId, partnerId), eq(chatMessages.recipientId, userId)),
          ),
        ))
        .orderBy(desc(chatMessages.createdAt))
        .limit(1);

      const [dmUnreadRow] = await db.select({ cnt: sql<number>`count(*)` })
        .from(chatMessages)
        .where(and(
          eq(chatMessages.organizationId, orgId),
          eq(chatMessages.senderId, partnerId),
          eq(chatMessages.recipientId, userId),
          gt(chatMessages.createdAt, dmLastReadAt),
        ));

      results.push({
        recipientId: partnerId,
        recipientFirstName: partner.firstName,
        recipientLastName: partner.lastName,
        recipientAvatarUrl: partner.avatarUrl ?? null,
        lastMessage: lastDmMsg?.content ?? null,
        lastMessageAt: lastDmMsg?.createdAt?.toISOString() ?? null,
        unreadCount: Number(dmUnreadRow?.cnt ?? 0),
      });
    }

    const [general, ...dms] = results;
    dms.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    return [general, ...dms];
  }

  async markThreadRead(orgId: string, userId: string, recipientId: string | null): Promise<void> {
    const now = new Date();
    if (recipientId === null) {
      await db.execute(sql`
        INSERT INTO chat_reads (organization_id, user_id, recipient_id, last_read_at)
        VALUES (${orgId}, ${userId}, NULL, ${now})
        ON CONFLICT (user_id, organization_id) WHERE recipient_id IS NULL
        DO UPDATE SET last_read_at = ${now}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO chat_reads (organization_id, user_id, recipient_id, last_read_at)
        VALUES (${orgId}, ${userId}, ${recipientId}, ${now})
        ON CONFLICT (user_id, organization_id, recipient_id) WHERE recipient_id IS NOT NULL
        DO UPDATE SET last_read_at = ${now}
      `);
    }
  }

  // --- Vehicle trackers (GT06 / fleet) ---
  async getTrackerDevices(orgId: string, commandFilter?: number[]): Promise<TrackerDeviceSummary[]> {
    const conditions = [eq(trackerDevices.organizationId, orgId)];
    if (commandFilter && commandFilter.length > 0) {
      conditions.push(inArray(trackerDevices.commandId, commandFilter));
    }

    const rows = await db
      .select({
        id: trackerDevices.id,
        imei: trackerDevices.imei,
        label: trackerDevices.label,
        commandId: trackerDevices.commandId,
        commandName: commands.name,
        lastLat: trackerDevices.lastLat,
        lastLng: trackerDevices.lastLng,
        lastSpeedKph: trackerDevices.lastSpeedKph,
        lastHeading: trackerDevices.lastHeading,
        lastIgnitionOn: trackerDevices.lastIgnitionOn,
        lastGpsValid: trackerDevices.lastGpsValid,
        lastPositionAt: trackerDevices.lastPositionAt,
        lastSeenAt: trackerDevices.lastSeenAt,
      })
      .from(trackerDevices)
      .leftJoin(commands, eq(trackerDevices.commandId, commands.id))
      .where(and(...conditions))
      .orderBy(desc(trackerDevices.lastSeenAt));

    return rows.map((r) => ({
      id: r.id,
      imei: r.imei,
      label: r.label,
      commandId: r.commandId,
      commandName: r.commandName,
      lastLat: r.lastLat,
      lastLng: r.lastLng,
      lastSpeedKph: r.lastSpeedKph,
      lastHeading: r.lastHeading,
      lastIgnitionOn: r.lastIgnitionOn,
      lastGpsValid: r.lastGpsValid,
      lastPositionAt: r.lastPositionAt?.toISOString() ?? null,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    }));
  }

  // --- Dashboard ---
  async getDashboardSummary(orgId: string, period: 'day' | 'week', restrictToLocationIds?: number[], commandFilter?: number[], restrictToUserId?: string): Promise<{
    totalIncidents: number;
    liveCount: number;
    chartData: Array<{ label: string; count: number }>;
    users: Array<{ id: string; firstName: string; lastName: string; role: string; avatarUrl: string | null; incidentCount: number; isLive: boolean; liveIncidentId: number | null; lastSeenAt: Date | null; lastLat: number | null; lastLng: number | null; lastPositionAt: Date | null }>;
  }> {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    let startDate: string;
    if (period === 'day') {
      startDate = todayStr;
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - 6);
      startDate = d.toISOString().slice(0, 10);
    }

    const locationCondition = restrictToLocationIds && restrictToLocationIds.length > 0
      ? or(inArray(incidents.locationId, restrictToLocationIds), isNull(incidents.locationId))
      : undefined;

    // Active-Command scoping (Task #212). When `commandFilter` is provided, only
    // count incidents from those Commands (legacy NULL rows kept for back-compat
    // with pre-migration data — see replit.md).
    const commandCondition = commandFilter && commandFilter.length > 0
      ? inArray(incidents.commandId, commandFilter)
      : undefined;

    const userCondition = restrictToUserId
      ? eq(incidents.userId, restrictToUserId)
      : undefined;

    const periodFilter = and(
      eq(incidents.organizationId, orgId),
      gte(incidents.incidentDate, startDate),
      lte(incidents.incidentDate, todayStr),
      locationCondition,
      commandCondition,
      userCondition,
    );

    const [totalResult] = await db.select({ count: sql<number>`count(*)` })
      .from(incidents).where(periodFilter);
    const totalIncidents = Number(totalResult.count);

    const liveFilter = and(
      eq(incidents.organizationId, orgId),
      eq(incidents.isLive, true),
      locationCondition,
      commandCondition,
    );

    let liveCount: number;
    if (restrictToUserId) {
      const creatorLive = await db.select({ id: incidents.id })
        .from(incidents)
        .where(and(liveFilter, eq(incidents.userId, restrictToUserId)));
      const joinerLive = await db.select({ incidentId: liveResponders.incidentId })
        .from(liveResponders)
        .innerJoin(incidents, eq(incidents.id, liveResponders.incidentId))
        .where(and(
          eq(liveResponders.organizationId, orgId),
          eq(liveResponders.userId, restrictToUserId),
          isNull(liveResponders.leftAt),
          eq(incidents.isLive, true),
          eq(incidents.organizationId, orgId),
          locationCondition,
          commandCondition,
        ));
      liveCount = new Set([
        ...creatorLive.map((r) => r.id),
        ...joinerLive.map((r) => r.incidentId),
      ]).size;
    } else {
      const [liveResult] = await db.select({ count: sql<number>`count(*)` })
        .from(incidents).where(liveFilter);
      liveCount = Number(liveResult.count);
    }

    let chartData: Array<{ label: string; count: number }> = [];
    if (period === 'day') {
      const dayFilter = and(
        eq(incidents.organizationId, orgId),
        eq(incidents.incidentDate, todayStr),
        locationCondition,
        commandCondition,
        userCondition,
      );
      const byHour = await db.select({
        hour: sql<number>`extract(hour from incident_time::time)::int`,
        count: sql<number>`count(*)`,
      })
        .from(incidents)
        .where(dayFilter)
        .groupBy(sql`extract(hour from incident_time::time)`)
        .orderBy(sql`extract(hour from incident_time::time)`);
      const hourMap = new Map(byHour.map(r => [Number(r.hour), Number(r.count)]));
      chartData = Array.from({ length: 24 }, (_, h) => ({
        label: `${String(h).padStart(2, '0')}:00`,
        count: hourMap.get(h) ?? 0,
      }));
    } else {
      const byDate = await db.select({
        date: incidents.incidentDate,
        count: sql<number>`count(*)`,
      })
        .from(incidents).where(periodFilter)
        .groupBy(incidents.incidentDate)
        .orderBy(incidents.incidentDate);
      const dateMap = new Map(byDate.map(r => [r.date, Number(r.count)]));
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric' });
        chartData.push({ label, count: dateMap.get(dateStr) ?? 0 });
      }
    }

    if (restrictToUserId) {
      return { totalIncidents, liveCount, chartData, users: [] };
    }

    const orgUsers = await db.select().from(users).where(
      and(eq(users.organizationId, orgId), eq(users.isActive, true))
    );

    const liveIncidentsList = await db.select({ userId: incidents.userId, id: incidents.id })
      .from(incidents)
      .where(liveFilter);
    const liveByUser = new Map(liveIncidentsList.map(i => [i.userId, i.id]));
    // Also include active joiners (who have joined but not yet left)
    const activeJoiners = await db.select({ userId: liveResponders.userId, incidentId: liveResponders.incidentId })
      .from(liveResponders)
      .where(and(eq(liveResponders.organizationId, orgId), isNull(liveResponders.leftAt)));
    for (const j of activeJoiners) {
      if (!liveByUser.has(j.userId)) liveByUser.set(j.userId, j.incidentId);
    }

    const userCounts = await db.select({ userId: incidents.userId, count: sql<number>`count(*)` })
      .from(incidents).where(periodFilter)
      .groupBy(incidents.userId);
    const countByUser = new Map(userCounts.map(r => [r.userId, Number(r.count)]));

    const userSummaries = orgUsers.map(u => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      avatarUrl: u.avatarUrl ?? null,
      incidentCount: countByUser.get(u.id) ?? 0,
      isLive: liveByUser.has(u.id),
      liveIncidentId: liveByUser.get(u.id) ?? null,
      lastSeenAt: u.lastSeenAt ?? null,
      lastLat: u.lastLat ?? null,
      lastLng: u.lastLng ?? null,
      lastPositionAt: u.lastPositionAt ?? null,
    }));
    userSummaries.sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      return b.incidentCount - a.incidentCount;
    });

    return { totalIncidents, liveCount, chartData, users: userSummaries };
  }

  // --- Commands ---
  async getCommands(orgId: string): Promise<Array<Command & { memberCount: number }>> {
    const rows = await db.execute<{ id: number; organization_id: string; name: string; is_central: boolean; created_at: Date; member_count: number }>(sql`
      SELECT c.id, c.organization_id, c.name, c.is_central, c.created_at,
             COALESCE((SELECT COUNT(*)::int FROM command_users cu WHERE cu.command_id = c.id), 0) AS member_count
      FROM commands c WHERE c.organization_id = ${orgId} ORDER BY c.is_central DESC, c.name ASC
    `);
    return rows.rows.map(r => ({
      id: r.id,
      organizationId: r.organization_id,
      name: r.name,
      isCentral: r.is_central,
      createdAt: r.created_at,
      memberCount: Number(r.member_count ?? 0),
    }));
  }

  async getCommand(id: number, orgId: string): Promise<Command | undefined> {
    const [row] = await db.select().from(commands).where(and(eq(commands.id, id), eq(commands.organizationId, orgId)));
    return row;
  }

  async createCommand(data: InsertCommand, orgId: string): Promise<Command> {
    const [row] = await db.insert(commands).values({ ...data, organizationId: orgId, isCentral: false }).returning();
    return row;
  }

  async updateCommand(id: number, data: Partial<InsertCommand>, orgId: string): Promise<Command | undefined> {
    const [row] = await db.update(commands).set(data).where(and(eq(commands.id, id), eq(commands.organizationId, orgId))).returning();
    return row;
  }

  async deleteCommand(id: number, orgId: string): Promise<boolean> {
    const existing = await this.getCommand(id, orgId);
    if (!existing || existing.isCentral) return false;
    await db.delete(commands).where(and(eq(commands.id, id), eq(commands.organizationId, orgId)));
    return true;
  }

  async getCommandMembers(commandId: number, orgId: string): Promise<Array<{ userId: string; firstName: string; lastName: string; email: string; role: string }>> {
    const rows = await db.execute<{ user_id: string; first_name: string; last_name: string; email: string; role: string }>(sql`
      SELECT u.id AS user_id, u.first_name, u.last_name, u.email, u.role
      FROM command_users cu
      INNER JOIN users u ON u.id = cu.user_id
      WHERE cu.command_id = ${commandId} AND cu.organization_id = ${orgId}
      ORDER BY u.last_name ASC, u.first_name ASC
    `);
    return rows.rows.map(r => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role }));
  }

  async assignUserToCommand(commandId: number, userId: string, orgId: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO command_users (command_id, user_id, organization_id)
      VALUES (${commandId}, ${userId}, ${orgId})
      ON CONFLICT ON CONSTRAINT command_user_unique DO NOTHING
    `);
  }

  async removeUserFromCommand(commandId: number, userId: string, orgId: string): Promise<void> {
    await db.delete(commandUsers).where(and(
      eq(commandUsers.commandId, commandId),
      eq(commandUsers.userId, userId),
      eq(commandUsers.organizationId, orgId),
    ));
  }

  async getUserCommands(userId: string): Promise<Command[]> {
    const rows = await db.execute<{ id: number; organization_id: string; name: string; is_central: boolean; created_at: Date }>(sql`
      SELECT c.id, c.organization_id, c.name, c.is_central, c.created_at
      FROM commands c
      INNER JOIN command_users cu ON cu.command_id = c.id
      WHERE cu.user_id = ${userId}
      ORDER BY c.is_central DESC, c.name ASC
    `);
    return rows.rows.map(r => ({
      id: r.id, organizationId: r.organization_id, name: r.name,
      isCentral: r.is_central, createdAt: r.created_at,
    }));
  }

  // --- Command Visibility Grants ---
  // A grant lets the `granteeCommand` read data belonging to `granterCommand`.
  async getVisibilityGrants(orgId: string): Promise<Array<CommandVisibilityGrant & { granterName: string; granteeName: string }>> {
    const rows = await db.execute<{
      id: number; grantee_command_id: number; granter_command_id: number;
      scope: string; granted_by_user_id: string | null; created_at: Date;
      organization_id: string; grantee_name: string; granter_name: string;
    }>(sql`
      SELECT v.id, v.grantee_command_id, v.granter_command_id, v.scope, v.granted_by_user_id,
             v.created_at, v.organization_id,
             ce.name AS grantee_name, cr.name AS granter_name
      FROM command_visibility_grants v
      INNER JOIN commands ce ON ce.id = v.grantee_command_id
      INNER JOIN commands cr ON cr.id = v.granter_command_id
      WHERE v.organization_id = ${orgId}
      ORDER BY ce.name, cr.name
    `);
    return rows.rows.map(r => ({
      id: r.id,
      granteeCommandId: r.grantee_command_id,
      granterCommandId: r.granter_command_id,
      scope: r.scope,
      grantedByUserId: r.granted_by_user_id,
      createdAt: r.created_at,
      organizationId: r.organization_id,
      granterName: r.granter_name,
      granteeName: r.grantee_name,
    }));
  }

  async createVisibilityGrant(
    data: InsertCommandVisibilityGrant,
    orgId: string,
    grantedByUserId: string,
  ): Promise<CommandVisibilityGrant> {
    const [row] = await db.insert(commandVisibilityGrants).values({
      ...data,
      organizationId: orgId,
      grantedByUserId,
    }).returning();
    return row;
  }

  async deleteVisibilityGrant(id: number, orgId: string): Promise<boolean> {
    const result = await db.delete(commandVisibilityGrants)
      .where(and(eq(commandVisibilityGrants.id, id), eq(commandVisibilityGrants.organizationId, orgId)))
      .returning({ id: commandVisibilityGrants.id });
    return result.length > 0;
  }

  // --- Command Visibility Requests (request → approve/deny flow) ---
  async listVisibilityRequests(
    orgId: string,
    requestedByUserId?: string,
  ): Promise<Array<CommandVisibilityRequest & { granteeName: string; granterName: string; requestedByName: string }>> {
    const filter = requestedByUserId
      ? sql`WHERE r.organization_id = ${orgId} AND r.requested_by_user_id = ${requestedByUserId}`
      : sql`WHERE r.organization_id = ${orgId}`;
    const rows = await db.execute<{
      id: number; organization_id: string; grantee_command_id: number; granter_command_id: number;
      requested_by_user_id: string; reason: string | null; status: string;
      decided_by_user_id: string | null; decided_at: Date | null; created_at: Date;
      grantee_name: string; granter_name: string; first_name: string; last_name: string;
    }>(sql`
      SELECT r.*, ce.name AS grantee_name, cr.name AS granter_name,
             u.first_name, u.last_name
      FROM command_visibility_requests r
      INNER JOIN commands ce ON ce.id = r.grantee_command_id
      INNER JOIN commands cr ON cr.id = r.granter_command_id
      INNER JOIN users u ON u.id = r.requested_by_user_id
      ${filter}
      ORDER BY r.status = 'pending' DESC, r.created_at DESC
    `);
    return rows.rows.map(r => ({
      id: r.id,
      organizationId: r.organization_id,
      granteeCommandId: r.grantee_command_id,
      granterCommandId: r.granter_command_id,
      requestedByUserId: r.requested_by_user_id,
      reason: r.reason,
      status: r.status,
      decidedByUserId: r.decided_by_user_id,
      decidedAt: r.decided_at,
      createdAt: r.created_at,
      granteeName: r.grantee_name,
      granterName: r.granter_name,
      requestedByName: `${r.first_name} ${r.last_name}`.trim(),
    }));
  }

  async createVisibilityRequest(
    data: InsertCommandVisibilityRequest,
    orgId: string,
    requestedByUserId: string,
  ): Promise<CommandVisibilityRequest> {
    const [row] = await db.insert(commandVisibilityRequests).values({
      ...data,
      organizationId: orgId,
      requestedByUserId,
    }).returning();
    return row;
  }

  // Approve or deny a pending request. On approve, a corresponding visibility
  // grant is also written (idempotent — duplicate grants are swallowed).
  async decideVisibilityRequest(
    id: number,
    orgId: string,
    action: "approve" | "deny",
    decidedByUserId: string,
  ): Promise<CommandVisibilityRequest | null> {
    return db.transaction(async (tx) => {
      const [req] = await tx.select().from(commandVisibilityRequests)
        .where(and(eq(commandVisibilityRequests.id, id), eq(commandVisibilityRequests.organizationId, orgId)));
      if (!req || req.status !== "pending") return null;
      const newStatus = action === "approve" ? "approved" : "denied";
      const [updated] = await tx.update(commandVisibilityRequests)
        .set({ status: newStatus, decidedByUserId, decidedAt: new Date() })
        .where(eq(commandVisibilityRequests.id, id))
        .returning();
      if (action === "approve") {
        try {
          await tx.insert(commandVisibilityGrants).values({
            organizationId: orgId,
            granteeCommandId: req.granteeCommandId,
            granterCommandId: req.granterCommandId,
            scope: "read",
            grantedByUserId: decidedByUserId,
          });
        } catch (e: any) {
          // 23505 = unique violation (grant already exists) — fine.
          if (e?.code !== "23505") throw e;
        }
      }
      return updated;
    });
  }

  // Returns the list of command IDs the grantee may read FROM (via visibility grants).
  async getGrantedCommandIds(granteeCommandIds: number[], orgId: string): Promise<number[]> {
    if (granteeCommandIds.length === 0) return [];
    const rows = await db.select({ granterCommandId: commandVisibilityGrants.granterCommandId })
      .from(commandVisibilityGrants)
      .where(and(
        eq(commandVisibilityGrants.organizationId, orgId),
        inArray(commandVisibilityGrants.granteeCommandId, granteeCommandIds),
      ));
    return Array.from(new Set(rows.map(r => r.granterCommandId)));
  }

  async deleteOrganization(orgId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const o = eq(notificationLogs.organizationId, orgId);
      await tx.delete(notificationLogs).where(o);
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.organizationId, orgId));
      await tx.delete(chatReads).where(eq(chatReads.organizationId, orgId));
      await tx.delete(chatMessages).where(eq(chatMessages.organizationId, orgId));
      await tx.delete(liveResponders).where(eq(liveResponders.organizationId, orgId));
      await tx.delete(panicAcknowledgers).where(eq(panicAcknowledgers.organizationId, orgId));
      await tx.delete(auditLogs).where(eq(auditLogs.organizationId, orgId));
      await tx.delete(incidentAttachments).where(eq(incidentAttachments.organizationId, orgId));
      await tx.delete(incidents).where(eq(incidents.organizationId, orgId));
      await tx.delete(importBatches).where(eq(importBatches.organizationId, orgId));
      await tx.delete(formFields).where(eq(formFields.organizationId, orgId));
      await tx.delete(incidentCategories).where(eq(incidentCategories.organizationId, orgId));
      await tx.delete(userLocationAssignments).where(eq(userLocationAssignments.organizationId, orgId));
      await tx.delete(locations).where(eq(locations.organizationId, orgId));
      await tx.delete(commandVisibilityRequests).where(eq(commandVisibilityRequests.organizationId, orgId));
      await tx.delete(commandVisibilityGrants).where(eq(commandVisibilityGrants.organizationId, orgId));
      await tx.delete(commandUsers).where(eq(commandUsers.organizationId, orgId));
      await tx.delete(commands).where(eq(commands.organizationId, orgId));
      await tx.delete(users).where(eq(users.organizationId, orgId));
      await tx.delete(organizations).where(eq(organizations.id, orgId));
    });
  }
}

export const storage = new DatabaseStorage();
