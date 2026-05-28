import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, doublePrecision, serial, boolean, jsonb, unique, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  trialEndsAt: timestamp("trial_ends_at"),
  subscriptionStatus: text("subscription_status").notNull().default("trial"),
  subscriptionCurrentPeriodEnd: timestamp("subscription_current_period_end"),
  payFastToken: text("payfast_token"),
  isComplimentary: boolean("is_complimentary").notNull().default(false),
  // Contract / billing config (set by Archon)
  contractRef: varchar("contract_ref"),
  contractStartDate: date("contract_start_date"),
  contractRenewalDate: date("contract_renewal_date"),
  rateAdmin: integer("rate_admin"),
  rateSupervisor: integer("rate_supervisor"),
  rateReporter: integer("rate_reporter"),
  storageLimitGb: integer("storage_limit_gb"),
  billingNotes: text("billing_notes"),
});

export const insertOrganizationSchema = createInsertSchema(organizations).omit({ id: true, createdAt: true });
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizations.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
  contactNumber: text("contact_number"),
  homeAddress: text("home_address"),
  posting: text("posting"),
  role: text("role").notNull().default("administrator"),
  isActive: boolean("is_active").notNull().default(true),
  password: text("password").notNull(),
  canEditIncidents: boolean("can_edit_incidents").notNull().default(true),
  canManageAttachments: boolean("can_manage_attachments").notNull().default(true),
  canDeleteIncidents: boolean("can_delete_incidents").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  avatarUrl: text("avatar_url"),
  inviteToken: text("invite_token").unique(),
  inviteTokenExpiresAt: timestamp("invite_token_expires_at"),
  lastSeenAt: timestamp("last_seen_at"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
});

// ── Commands (sub-organisations within an org) ──────────────────────────────
export const commands = pgTable("commands", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isCentral: boolean("is_central").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertCommandSchema = createInsertSchema(commands).omit({ id: true, createdAt: true, organizationId: true });
export type InsertCommand = z.infer<typeof insertCommandSchema>;
export type Command = typeof commands.$inferSelect;

export const commandUsers = pgTable("command_users", {
  id: serial("id").primaryKey(),
  commandId: integer("command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("command_user_unique").on(table.commandId, table.userId),
]);
export type CommandUser = typeof commandUsers.$inferSelect;

// Cross-Command visibility grants — superadmin authorises Command A to see Command B's data
export const commandVisibilityGrants = pgTable("command_visibility_grants", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  granteeCommandId: integer("grantee_command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  granterCommandId: integer("granter_command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  scope: text("scope").notNull().default("read"),
  grantedByUserId: varchar("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("command_visibility_unique").on(table.granteeCommandId, table.granterCommandId, table.scope),
]);
export const insertCommandVisibilityGrantSchema = createInsertSchema(commandVisibilityGrants).omit({ id: true, createdAt: true, organizationId: true, grantedByUserId: true });
export type InsertCommandVisibilityGrant = z.infer<typeof insertCommandVisibilityGrantSchema>;
export type CommandVisibilityGrant = typeof commandVisibilityGrants.$inferSelect;

// Cross-Command visibility *requests* — a user (typically administrator)
// requests read access from one Command to another. A superadmin approves
// or denies. On approval a row in commandVisibilityGrants is also written.
export const commandVisibilityRequests = pgTable("command_visibility_requests", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  granteeCommandId: integer("grantee_command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  granterCommandId: integer("granter_command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  requestedByUserId: varchar("requested_by_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | approved | denied
  decidedByUserId: varchar("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const insertCommandVisibilityRequestSchema = createInsertSchema(commandVisibilityRequests).omit({
  id: true, createdAt: true, organizationId: true, requestedByUserId: true,
  status: true, decidedByUserId: true, decidedAt: true,
});
export type InsertCommandVisibilityRequest = z.infer<typeof insertCommandVisibilityRequestSchema>;
export type CommandVisibilityRequest = typeof commandVisibilityRequests.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  color: text("color").default("#6B7280"),
  icon: text("icon").default("map-pin"),
  commandId: integer("command_id"),
});

export const insertLocationSchema = createInsertSchema(locations).omit({ id: true, organizationId: true });
export type InsertLocation = z.infer<typeof insertLocationSchema>;
export type Location = typeof locations.$inferSelect;

export const incidentCategories = pgTable("incident_categories", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").default("#3B82F6"),
  icon: text("icon").default("alert"),
  isOther: boolean("is_other").notNull().default(false),
  isSystem: boolean("is_system").notNull().default(false),
  severity: text("severity"),
  commandId: integer("command_id"),
});

export const insertCategorySchema = createInsertSchema(incidentCategories).omit({ id: true, organizationId: true });
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof incidentCategories.$inferSelect;

export const customMaps = pgTable("custom_maps", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  imageUrl: text("image_url").notNull(),
  imageWidth: integer("image_width"),
  imageHeight: integer("image_height"),
  sortOrder: integer("sort_order").notNull().default(0),
  // Per-Command scoping (Task #212). Nullable + backfilled by migrate-commands.ts.
  commandId: integer("command_id"),
});

export const insertCustomMapSchema = createInsertSchema(customMaps).omit({ id: true, organizationId: true, commandId: true });
export type InsertCustomMap = z.infer<typeof insertCustomMapSchema>;
export type CustomMap = typeof customMaps.$inferSelect;

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("pending"),
  totalRows: integer("total_rows").notNull().default(0),
  importedRows: integer("imported_rows").notNull().default(0),
  failedRows: integer("failed_rows").notNull().default(0),
  fieldMapping: jsonb("field_mapping").$type<Record<string, unknown>>(),
  errorSummary: jsonb("error_summary").$type<Array<{ rowNumber: number; errors: string[]; originalRow?: Record<string, string> }>>(),
  createdCategoryIds: integer("created_category_ids").array(),
  createdLocationIds: integer("created_location_ids").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const insertImportBatchSchema = createInsertSchema(importBatches).omit({ id: true, createdAt: true, completedAt: true });
export type InsertImportBatch = z.infer<typeof insertImportBatchSchema>;
export type ImportBatch = typeof importBatches.$inferSelect;

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  incidentDate: text("incident_date").notNull(),
  incidentTime: text("incident_time").notNull(),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
  locationName: text("location_name"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  customMapId: integer("custom_map_id").references(() => customMaps.id, { onDelete: "set null" }),
  customMapX: doublePrecision("custom_map_x"),
  customMapY: doublePrecision("custom_map_y"),
  categoryId: integer("category_id").references(() => incidentCategories.id, { onDelete: "set null" }),
  otherCategoryNote: text("other_category_note"),
  description: text("description"),
  customFields: jsonb("custom_fields").$type<Record<string, string | number | null>>(),
  importBatchId: integer("import_batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  isLive: boolean("is_live").notNull().default(false),
  isEscalated: boolean("is_escalated").notNull().default(false),
  liveStartedAt: timestamp("live_started_at"),
  responderLat: doublePrecision("responder_lat"),
  responderLng: doublePrecision("responder_lng"),
  responderPositionUpdatedAt: timestamp("responder_position_updated_at"),
  responderArrivedAt: timestamp("responder_arrived_at"),
  liveStartLat: doublePrecision("live_start_lat"),
  liveStartLng: doublePrecision("live_start_lng"),
  destinationName: text("destination_name"),
  destinationLat: doublePrecision("destination_lat"),
  destinationLng: doublePrecision("destination_lng"),
  liveEndedAt: timestamp("live_ended_at"),
  liveClosedManually: boolean("live_closed_manually"),
  liveConvertLat: doublePrecision("live_convert_lat"),
  liveConvertLng: doublePrecision("live_convert_lng"),
  liveEndLat: doublePrecision("live_end_lat"),
  liveEndLng: doublePrecision("live_end_lng"),
  severity: text("severity"),
  panicAcknowledgedAt: timestamp("panic_acknowledged_at"),
  panicAcknowledgedByUserId: varchar("panic_acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  panicClosedAt: timestamp("panic_closed_at"),
  closedByUserId: varchar("closed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  commandId: integer("command_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const panicAcknowledgers = pgTable("panic_acknowledgers", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  acknowledgedAt: timestamp("acknowledged_at").defaultNow().notNull(),
}, (table) => [
  unique("panic_ack_incident_user_unique").on(table.incidentId, table.userId),
]);
export type PanicAcknowledger = typeof panicAcknowledgers.$inferSelect;

export const insertIncidentSchema = createInsertSchema(incidents).omit({ id: true, createdAt: true, organizationId: true, importBatchId: true, userId: true, isEscalated: true });
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidents.$inferSelect;

export const userLocationAssignments = pgTable("user_location_assignments", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  locationId: integer("location_id").notNull().references(() => locations.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
}, (table) => [
  unique("user_location_unique").on(table.userId, table.locationId),
]);

export const insertUserLocationAssignmentSchema = createInsertSchema(userLocationAssignments).omit({ id: true });
export type InsertUserLocationAssignment = z.infer<typeof insertUserLocationAssignmentSchema>;
export type UserLocationAssignment = typeof userLocationAssignments.$inferSelect;

export const incidentAttachments = pgTable("incident_attachments", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAttachmentSchema = createInsertSchema(incidentAttachments).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof incidentAttachments.$inferSelect;

export const formFields = pgTable("form_fields", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  fieldKey: text("field_key").notNull(),
  label: text("label").notNull(),
  fieldType: text("field_type").notNull().default("text"),
  isRequired: boolean("is_required").notNull().default(true),
  isVisible: boolean("is_visible").notNull().default(true),
  isSystem: boolean("is_system").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  options: text("options"),
  commandId: integer("command_id"),
}, (table) => [
  unique("form_fields_field_key_org_unique").on(table.fieldKey, table.organizationId),
]);

export const insertFormFieldSchema = createInsertSchema(formFields).omit({ id: true, organizationId: true });
export type InsertFormField = z.infer<typeof insertFormFieldSchema>;
export type FormField = typeof formFields.$inferSelect;

export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  description: text("description").notNull(),
  changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notificationLogs = pgTable("notification_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  incidentId: integer("incident_id").references(() => incidents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNotificationLogSchema = createInsertSchema(notificationLogs).omit({ id: true, createdAt: true });
export type InsertNotificationLog = z.infer<typeof insertNotificationLogSchema>;
export type NotificationLog = typeof notificationLogs.$inferSelect;

export const liveResponders = pgTable("live_responders", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  leftAt: timestamp("left_at"),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastPositionAt: timestamp("last_position_at"),
  arrivedAt: timestamp("arrived_at"),
  arrivalNote: text("arrival_note"),
  destinationLat: doublePrecision("destination_lat"),
  destinationLng: doublePrecision("destination_lng"),
  destinationName: text("destination_name"),
});

export const insertLiveResponderSchema = createInsertSchema(liveResponders).omit({ id: true, joinedAt: true });
export type InsertLiveResponder = z.infer<typeof insertLiveResponderSchema>;
export type LiveResponder = typeof liveResponders.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  senderId: varchar("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: varchar("recipient_id").references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export const chatReads = pgTable("chat_reads", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: varchar("recipient_id").references(() => users.id, { onDelete: "cascade" }),
  lastReadAt: timestamp("last_read_at").defaultNow().notNull(),
});

export const contactSubmissions = pgTable("contact_submissions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  organisation: text("organisation"),
  email: text("email").notNull(),
  phone: text("phone"),
  message: text("message").notNull(),
  emailSentAt: timestamp("email_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertContactSubmissionSchema = createInsertSchema(contactSubmissions).omit({ id: true, createdAt: true, emailSentAt: true });
export type InsertContactSubmission = z.infer<typeof insertContactSubmissionSchema>;
export type ContactSubmission = typeof contactSubmissions.$inferSelect;

export const fcmTokens = pgTable("fcm_tokens", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
