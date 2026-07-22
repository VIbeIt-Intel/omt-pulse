import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, doublePrecision, serial, boolean, jsonb, unique, date, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { WorkstationType } from "./workstations";

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  address: text("address").notNull(),
  addressStreet: text("address_street"),
  addressSuburb: text("address_suburb"),
  addressCity: text("address_city"),
  addressProvince: text("address_province"),
  addressPostalCode: text("address_postal_code"),
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
  rateAccessController: integer("rate_access_controller"),
  rateControlRoom: integer("rate_control_room"),
  ratePatrolUser: integer("rate_patrol_user"),
  storageLimitGb: integer("storage_limit_gb"),
  billingNotes: text("billing_notes"),
  companyRegistrationNumber: text("company_registration_number"),
  vatNumber: text("vat_number"),
  primaryContactFirstName: text("primary_contact_first_name"),
  primaryContactLastName: text("primary_contact_last_name"),
  primaryContactEmail: text("primary_contact_email"),
  primaryContactPhone: text("primary_contact_phone"),
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
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastPositionAt: timestamp("last_position_at"),
  isSuperadmin: boolean("is_superadmin").notNull().default(false),
  /** bcrypt hash of 4–6 digit shift PIN for shared / dedicated device login */
  shiftPinHash: text("shift_pin_hash"),
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

/** Enrolled dedicated device bound to a premises / post (gate tablet, shared shift phone). */
export const workstations = pgTable("workstations", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull().$type<WorkstationType>().default("gate_desk"),
  locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
  commandId: integer("command_id").references(() => commands.id, { onDelete: "set null" }),
  deviceToken: text("device_token").unique(),
  enrolmentCode: text("enrolment_code"),
  enrolmentExpiresAt: timestamp("enrolment_expires_at"),
  enrolledAt: timestamp("enrolled_at"),
  lastSeenAt: timestamp("last_seen_at"),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  kioskMode: boolean("kiosk_mode").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  /** Synthetic user representing this position (no-PIN dedicated device login). */
  positionUserId: varchar("position_user_id").references(() => users.id, { onDelete: "set null" }),
  currentOperatorUserId: varchar("current_operator_user_id").references(() => users.id, { onDelete: "set null" }),
  operatorSessionStartedAt: timestamp("operator_session_started_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkstationSchema = createInsertSchema(workstations).omit({
  id: true,
  createdAt: true,
  organizationId: true,
  deviceToken: true,
  enrolmentCode: true,
  enrolmentExpiresAt: true,
  enrolledAt: true,
  lastSeenAt: true,
  lastLat: true,
  lastLng: true,
  positionUserId: true,
  currentOperatorUserId: true,
  operatorSessionStartedAt: true,
});
export type InsertWorkstation = z.infer<typeof insertWorkstationSchema>;
export type Workstation = typeof workstations.$inferSelect;

export type WorkstationWithDetails = Workstation & {
  locationName: string | null;
  commandName: string | null;
  currentOperatorName: string | null;
};

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

/** scene = captured at reporting / live close; supplementary = added after the fact */
export const EVIDENCE_PHASES = ["scene", "supplementary"] as const;
export type EvidencePhase = (typeof EVIDENCE_PHASES)[number];

export const incidentAttachments = pgTable("incident_attachments", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  uploadedByUserId: varchar("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  evidencePhase: varchar("evidence_phase", { length: 20 }),
  url: text("url").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  /** Stored file size in bytes when known (for Archon storage metering). */
  byteSize: bigint("byte_size", { mode: "number" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAttachmentSchema = createInsertSchema(incidentAttachments).omit({ id: true, createdAt: true, uploadedByUserId: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof incidentAttachments.$inferSelect;

export type AttachmentWithUploader = Attachment & {
  uploadedByFirstName: string | null;
  uploadedByLastName: string | null;
};

export const incidentEvidenceNotes = pgTable("incident_evidence_notes", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  authorUserId: varchar("author_user_id").references(() => users.id, { onDelete: "set null" }),
  evidencePhase: varchar("evidence_phase", { length: 20 }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEvidenceNoteSchema = createInsertSchema(incidentEvidenceNotes).omit({
  id: true,
  createdAt: true,
  authorUserId: true,
});
export type InsertEvidenceNote = z.infer<typeof insertEvidenceNoteSchema>;
export type EvidenceNote = typeof incidentEvidenceNotes.$inferSelect;

export type EvidenceNoteWithAuthor = EvidenceNote & {
  authorFirstName: string | null;
  authorLastName: string | null;
};

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

/** GPS tracker hardware registered by IMEI (GT06 and future protocols). */
export const trackerDevices = pgTable("tracker_devices", {
  id: serial("id").primaryKey(),
  imei: varchar("imei", { length: 20 }).notNull().unique(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  commandId: integer("command_id").references(() => commands.id, { onDelete: "set null" }),
  protocol: varchar("protocol", { length: 32 }).notNull().default("gt06"),
  label: text("label"),
  vehicleMake: text("vehicle_make"),
  vehicleModel: text("vehicle_model"),
  vehicleRegistration: text("vehicle_registration"),
  vehiclePhotoUrl: text("vehicle_photo_url"),
  assignedUserId: varchar("assigned_user_id").references(() => users.id, { onDelete: "set null" }),
  notes: text("notes"),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastSpeedKph: doublePrecision("last_speed_kph"),
  lastHeading: doublePrecision("last_heading"),
  lastIgnitionOn: boolean("last_ignition_on"),
  lastMileageKm: doublePrecision("last_mileage_km"),
  todayOdometerDistanceKm: doublePrecision("today_odometer_distance_km"),
  todayGpsDistanceKm: doublePrecision("today_gps_distance_km"),
  lastTripDistanceKm: doublePrecision("last_trip_distance_km"),
  lastGpsValid: boolean("last_gps_valid"),
  lastPositionAt: timestamp("last_position_at"),
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTrackerDeviceSchema = createInsertSchema(trackerDevices).omit({ id: true, createdAt: true });
export type InsertTrackerDevice = z.infer<typeof insertTrackerDeviceSchema>;
export type TrackerDevice = typeof trackerDevices.$inferSelect;

/** Historical GPS positions from tracker devices. */
export const trackerPositions = pgTable("tracker_positions", {
  id: serial("id").primaryKey(),
  deviceId: integer("device_id").notNull().references(() => trackerDevices.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  speedKph: doublePrecision("speed_kph"),
  heading: doublePrecision("heading"),
  ignitionOn: boolean("ignition_on"),
  mileageKm: doublePrecision("mileage_km"),
  gpsValid: boolean("gps_valid").notNull().default(true),
  packetType: varchar("packet_type", { length: 16 }),
  recordedAt: timestamp("recorded_at").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export const insertTrackerPositionSchema = createInsertSchema(trackerPositions).omit({ id: true, receivedAt: true });
export type InsertTrackerPosition = z.infer<typeof insertTrackerPositionSchema>;
export type TrackerPosition = typeof trackerPositions.$inferSelect;

// ── Fleet alerts ───────────────────────────────────────────────────────────────

export const fleetAlertDefaults = pgTable("fleet_alert_defaults", {
  organizationId: varchar("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  speedLimitKph: doublePrecision("speed_limit_kph").notNull().default(120),
  idleMinutes: integer("idle_minutes").notNull().default(30),
  offlineMinutes: integer("offline_minutes").notNull().default(30),
  geofenceEnabled: boolean("geofence_enabled").notNull().default(false),
  geofenceLat: doublePrecision("geofence_lat"),
  geofenceLng: doublePrecision("geofence_lng"),
  geofenceRadiusM: doublePrecision("geofence_radius_m").default(2000),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const fleetDeviceAlertRules = pgTable("fleet_device_alert_rules", {
  deviceId: integer("device_id")
    .primaryKey()
    .references(() => trackerDevices.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  speedLimitKph: doublePrecision("speed_limit_kph"),
  idleMinutes: integer("idle_minutes"),
  offlineMinutes: integer("offline_minutes"),
  geofenceEnabled: boolean("geofence_enabled"),
  geofenceLat: doublePrecision("geofence_lat"),
  geofenceLng: doublePrecision("geofence_lng"),
  geofenceRadiusM: doublePrecision("geofence_radius_m"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const fleetAlerts = pgTable("fleet_alerts", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  deviceId: integer("device_id").notNull().references(() => trackerDevices.id, { onDelete: "cascade" }),
  alertType: varchar("alert_type", { length: 32 }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  details: text("details"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  speedKph: doublePrecision("speed_kph"),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  pushSent: boolean("push_sent").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: varchar("acknowledged_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export type FleetAlertDefaults = typeof fleetAlertDefaults.$inferSelect;
export type FleetDeviceAlertRules = typeof fleetDeviceAlertRules.$inferSelect;
export type FleetAlert = typeof fleetAlerts.$inferSelect;

export type ResolvedFleetAlertRules = {
  alertsEnabled: boolean;
  speedLimitKph: number;
  idleMinutes: number;
  offlineMinutes: number;
  geofenceEnabled: boolean;
  geofenceLat: number | null;
  geofenceLng: number | null;
  geofenceRadiusM: number;
};

export type FleetAlertSummary = FleetAlert & {
  vehicleLabel: string | null;
  vehicleRegistration: string | null;
};

// ── Access Control (Phase 1) ─────────────────────────────────────────────────

export const ACCESS_ENTRY_CATEGORIES = [
  "visitor",
  "contractor",
  "delivery",
  "official_vehicle",
  "other",
] as const;
export type AccessEntryCategory = (typeof ACCESS_ENTRY_CATEGORIES)[number];

export const ACCESS_LOG_STATUSES = ["inside", "exited"] as const;
export type AccessLogStatus = (typeof ACCESS_LOG_STATUSES)[number];

/** Pre-configured destinations guards must select when logging entry. */
export const destinations = pgTable("destinations", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** Premises this destination belongs to (gate destinations scoped per site). */
  locationId: integer("location_id").references(() => locations.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  type: text("type").notNull().default("building"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDestinationSchema = createInsertSchema(destinations).omit({ id: true, createdAt: true, organizationId: true });
export type InsertDestination = z.infer<typeof insertDestinationSchema>;
export type Destination = typeof destinations.$inferSelect;

export const ACCESS_PARTY_ROLES = ["walk_in", "driver", "passenger"] as const;
export type AccessPartyRole = (typeof ACCESS_PARTY_ROLES)[number];

export const accessLogs = pgTable("access_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  destinationId: integer("destination_id").notNull().references(() => destinations.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("inside"),
  /** Shared id for everyone checked in together (e.g. one vehicle party). */
  visitGroupId: varchar("visit_group_id"),
  partyRole: text("party_role"),
  personFullName: text("person_full_name").notNull(),
  personIdNumber: text("person_id_number"),
  scanData: jsonb("scan_data").$type<import("./access-scan-data").AccessScanData | null>(),
  companyName: text("company_name"),
  contactNumber: text("contact_number"),
  purpose: text("purpose"),
  personPhotoUrl: text("person_photo_url"),
  vehiclePhotoUrl: text("vehicle_photo_url"),
  timeIn: timestamp("time_in").defaultNow().notNull(),
  timeOut: timestamp("time_out"),
  loggedByUserId: varchar("logged_by_user_id").references(() => users.id, { onDelete: "set null" }),
  workstationId: integer("workstation_id").references(() => workstations.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAccessLogSchema = createInsertSchema(accessLogs).omit({
  id: true,
  createdAt: true,
  organizationId: true,
  status: true,
  timeIn: true,
  timeOut: true,
  loggedByUserId: true,
});
export type InsertAccessLog = z.infer<typeof insertAccessLogSchema>;
export type AccessLog = typeof accessLogs.$inferSelect;

export const accessLogVehicles = pgTable("access_log_vehicles", {
  id: serial("id").primaryKey(),
  accessLogId: integer("access_log_id").notNull().references(() => accessLogs.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  registration: text("registration"),
  make: text("make"),
  model: text("model"),
  colour: text("colour"),
  licenceDiscData: text("licence_disc_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAccessLogVehicleSchema = createInsertSchema(accessLogVehicles).omit({
  id: true,
  createdAt: true,
  organizationId: true,
  accessLogId: true,
});
export type InsertAccessLogVehicle = z.infer<typeof insertAccessLogVehicleSchema>;
export type AccessLogVehicle = typeof accessLogVehicles.$inferSelect;

export type AccessLogWithDetails = AccessLog & {
  destinationName: string;
  loggedByName: string | null;
  vehicle: AccessLogVehicle | null;
};

// ── Patrolling (MVP) ───────────────────────────────────────────────────────────

export const PATROL_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type PatrolStatus = (typeof PATROL_STATUSES)[number];

export const PATROL_CHECKPOINT_LOG_STATUSES = ["completed", "missed"] as const;
export type PatrolCheckpointLogStatus = (typeof PATROL_CHECKPOINT_LOG_STATUSES)[number];

/** Pre-planned patrol path defined by an administrator or supervisor. */
export const patrolRoutes = pgTable("patrol_routes", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** Optional Group scope — routes can be limited to a Command. */
  commandId: integer("command_id").references(() => commands.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("patrol_routes_org_name_unique").on(table.organizationId, table.name),
]);

export const insertPatrolRouteSchema = createInsertSchema(patrolRoutes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  /** Set from session on the server — never accept from the client. */
  createdByUserId: true,
});
export type InsertPatrolRoute = z.infer<typeof insertPatrolRouteSchema>;
export type PatrolRoute = typeof patrolRoutes.$inferSelect;

/** Soft geofence radius (metres) used when a checkpoint has coordinates. */
/** Must be at the pin — soft 75 m was too lenient for field proof. */
export const DEFAULT_PATROL_CHECKPOINT_RADIUS_M = 40;

/** Ordered stop on a patrol route. */
export const patrolCheckpoints = pgTable("patrol_checkpoints", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  routeId: integer("route_id").notNull().references(() => patrolRoutes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  orderIndex: integer("order_index").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  /** Soft proof radius; clock is allowed outside but flagged for management. */
  geofenceRadiusM: doublePrecision("geofence_radius_m").notNull().default(DEFAULT_PATROL_CHECKPOINT_RADIUS_M),
  instructions: text("instructions"),
  photoRequired: boolean("photo_required").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("patrol_checkpoints_route_order_unique").on(table.routeId, table.orderIndex),
]);

export const insertPatrolCheckpointSchema = createInsertSchema(patrolCheckpoints).omit({
  id: true,
  createdAt: true,
  organizationId: true,
  routeId: true,
});
export type InsertPatrolCheckpoint = z.infer<typeof insertPatrolCheckpointSchema>;
export type PatrolCheckpoint = typeof patrolCheckpoints.$inferSelect;

/** A guard executing a route (Patrol User or Access Controller). */
export const patrols = pgTable("patrols", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  routeId: integer("route_id").notNull().references(() => patrolRoutes.id, { onDelete: "restrict" }),
  startedByUserId: varchar("started_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  status: text("status").notNull().default("in_progress"),
  totalCheckpoints: integer("total_checkpoints").notNull(),
  completedCheckpoints: integer("completed_checkpoints").notNull().default(0),
  /** Opaque token for background GPS batch upload; cleared when patrol ends. */
  trackUploadToken: text("track_upload_token"),
  trackPointCount: integer("track_point_count").notNull().default(0),
  distanceM: doublePrecision("distance_m"),
  maxGapSeconds: integer("max_gap_seconds"),
  geofencePassCount: integer("geofence_pass_count").notNull().default(0),
  geofenceFailCount: integer("geofence_fail_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPatrolSchema = createInsertSchema(patrols).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  endedAt: true,
  completedCheckpoints: true,
  trackUploadToken: true,
  trackPointCount: true,
  distanceM: true,
  maxGapSeconds: true,
  geofencePassCount: true,
  geofenceFailCount: true,
});
export type InsertPatrol = z.infer<typeof insertPatrolSchema>;
export type Patrol = typeof patrols.$inferSelect;

/** Proof record when a checkpoint is clocked or marked missed. */
export const patrolCheckpointLogs = pgTable("patrol_checkpoint_logs", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  patrolId: integer("patrol_id").notNull().references(() => patrols.id, { onDelete: "cascade" }),
  checkpointId: integer("checkpoint_id").notNull().references(() => patrolCheckpoints.id, { onDelete: "restrict" }),
  clockedAt: timestamp("clocked_at").defaultNow().notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracyM: doublePrecision("accuracy_m"),
  distanceM: doublePrecision("distance_m"),
  /** null when checkpoint has no coords or GPS missing; false = outside soft radius. */
  withinGeofence: boolean("within_geofence"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  status: text("status").notNull().default("completed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("patrol_checkpoint_logs_patrol_checkpoint_unique").on(table.patrolId, table.checkpointId),
]);

export const insertPatrolCheckpointLogSchema = createInsertSchema(patrolCheckpointLogs).omit({
  id: true,
  createdAt: true,
  organizationId: true,
  patrolId: true,
  clockedAt: true,
  accuracyM: true,
  distanceM: true,
  withinGeofence: true,
});
export type InsertPatrolCheckpointLog = z.infer<typeof insertPatrolCheckpointLogSchema>;
export type PatrolCheckpointLog = typeof patrolCheckpointLogs.$inferSelect;

/** GPS breadcrumb recorded during an active patrol. */
export const patrolTrackPoints = pgTable("patrol_track_points", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  patrolId: integer("patrol_id").notNull().references(() => patrols.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracyM: doublePrecision("accuracy_m"),
  heading: doublePrecision("heading"),
  speedMps: doublePrecision("speed_mps"),
  altitudeM: doublePrecision("altitude_m"),
  source: text("source").notNull().default("device"),
  /** Client-monotonic sequence for idempotent batch upload. */
  seq: integer("seq"),
}, (table) => [
  unique("patrol_track_points_patrol_seq_unique").on(table.patrolId, table.seq),
]);

export const insertPatrolTrackPointSchema = createInsertSchema(patrolTrackPoints).omit({
  id: true,
  receivedAt: true,
  organizationId: true,
  patrolId: true,
});
export type InsertPatrolTrackPoint = z.infer<typeof insertPatrolTrackPointSchema>;
export type PatrolTrackPoint = typeof patrolTrackPoints.$inferSelect;

export type PatrolWithRoute = Patrol & {
  routeName: string;
  startedByName: string;
};

export type PatrolCheckpointLogWithCheckpoint = PatrolCheckpointLog & {
  checkpointName: string;
  orderIndex: number;
};

/** Jittered push schedule for a patrol route (one per route). */
export const patrolRouteSchedules = pgTable("patrol_route_schedules", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  routeId: integer("route_id").notNull().references(() => patrolRoutes.id, { onDelete: "cascade" }),
  isEnabled: boolean("is_enabled").notNull().default(false),
  /** Target minutes between prompts (~hourly by default). */
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  /** Random ± minutes applied to each interval. */
  jitterMinutes: integer("jitter_minutes").notNull().default(12),
  /** How long the patroller has to tap Start after a push. */
  startWithinMinutes: integer("start_within_minutes").notNull().default(15),
  /** Quiet hours in Africa/Johannesburg local time (nullable = none). */
  quietStartHour: integer("quiet_start_hour"),
  quietEndHour: integer("quiet_end_hour"),
  nextDueAt: timestamp("next_due_at").notNull(),
  lastDispatchedAt: timestamp("last_dispatched_at"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("patrol_route_schedules_route_unique").on(table.routeId),
]);

export const insertPatrolRouteScheduleSchema = createInsertSchema(patrolRouteSchedules).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  createdByUserId: true,
  lastDispatchedAt: true,
});
export type InsertPatrolRouteSchedule = z.infer<typeof insertPatrolRouteScheduleSchema>;
export type PatrolRouteSchedule = typeof patrolRouteSchedules.$inferSelect;

/** Explicit assignees for a schedule. Empty = fall back to route group / all patrol.execute users. */
export const patrolScheduleAssignees = pgTable("patrol_schedule_assignees", {
  scheduleId: integer("schedule_id").notNull().references(() => patrolRouteSchedules.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
}, (table) => [
  unique("patrol_schedule_assignees_pk").on(table.scheduleId, table.userId),
]);

export const PATROL_DISPATCH_STATUSES = ["pending", "started", "overdue", "missed", "cancelled"] as const;
export type PatrolDispatchStatus = (typeof PATROL_DISPATCH_STATUSES)[number];

/** One push prompt to a patroller for a scheduled route. */
export const patrolScheduleDispatches = pgTable("patrol_schedule_dispatches", {
  id: serial("id").primaryKey(),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  scheduleId: integer("schedule_id").notNull().references(() => patrolRouteSchedules.id, { onDelete: "cascade" }),
  routeId: integer("route_id").notNull().references(() => patrolRoutes.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  pushedAt: timestamp("pushed_at").defaultNow().notNull(),
  startByAt: timestamp("start_by_at").notNull(),
  patrolId: integer("patrol_id").references(() => patrols.id, { onDelete: "set null" }),
  overdueNotifiedAt: timestamp("overdue_notified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PatrolScheduleDispatch = typeof patrolScheduleDispatches.$inferSelect;
