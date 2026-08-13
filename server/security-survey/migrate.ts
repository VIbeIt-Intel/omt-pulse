import { db } from "../storage";
import { sql } from "drizzle-orm";
import { DEFAULT_SURVEY_TEMPLATE_ITEMS } from "@shared/security-survey";

/** Idempotent startup migration for Security / Site Survey tables + default template seed. */
export async function migrateSecuritySurvey() {
  const safe = async (label: string, stmt: ReturnType<typeof sql>) => {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn(`[security-survey-migration] ${label}:`, err instanceof Error ? err.message : err);
    }
  };

  await safe("survey_templates.create", sql`
    CREATE TABLE IF NOT EXISTS survey_templates (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_user_id VARCHAR REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("survey_templates.org_idx", sql`
    CREATE INDEX IF NOT EXISTS survey_templates_org_idx ON survey_templates (organization_id)
  `);

  await safe("survey_template_items.create", sql`
    CREATE TABLE IF NOT EXISTS survey_template_items (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES survey_templates(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      prompt TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      photo_required BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await safe("survey_template_items.template_idx", sql`
    CREATE INDEX IF NOT EXISTS survey_template_items_template_idx
      ON survey_template_items (template_id, sort_order)
  `);

  await safe("security_surveys.create", sql`
    CREATE TABLE IF NOT EXISTS security_surveys (
      id SERIAL PRIMARY KEY,
      organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      command_id INTEGER REFERENCES commands(id) ON DELETE SET NULL,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
      template_id INTEGER NOT NULL REFERENCES survey_templates(id) ON DELETE RESTRICT,
      surveyor_user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'draft',
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      client_name_override TEXT,
      recommendations TEXT,
      progress_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("security_surveys.org_status_idx", sql`
    CREATE INDEX IF NOT EXISTS security_surveys_org_status_idx
      ON security_surveys (organization_id, status, started_at DESC)
  `);
  await safe("security_surveys.location_idx", sql`
    CREATE INDEX IF NOT EXISTS security_surveys_location_idx ON security_surveys (location_id)
  `);
  await safe("security_surveys.surveyor_idx", sql`
    CREATE INDEX IF NOT EXISTS security_surveys_surveyor_idx
      ON security_surveys (surveyor_user_id, started_at DESC)
  `);

  await safe("survey_findings.create", sql`
    CREATE TABLE IF NOT EXISTS survey_findings (
      id SERIAL PRIMARY KEY,
      survey_id INTEGER NOT NULL REFERENCES security_surveys(id) ON DELETE CASCADE,
      template_item_id INTEGER REFERENCES survey_template_items(id) ON DELETE SET NULL,
      category TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      severity TEXT,
      notes TEXT,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      gps_accuracy_m DOUBLE PRECISION,
      converted_incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("survey_findings.survey_idx", sql`
    CREATE INDEX IF NOT EXISTS survey_findings_survey_idx ON survey_findings (survey_id)
  `);
  await safe("survey_findings.template_item_unique", sql`
    CREATE UNIQUE INDEX IF NOT EXISTS survey_findings_survey_item_unique
      ON survey_findings (survey_id, template_item_id)
      WHERE template_item_id IS NOT NULL
  `);

  await safe("survey_finding_photos.create", sql`
    CREATE TABLE IF NOT EXISTS survey_finding_photos (
      id SERIAL PRIMARY KEY,
      finding_id INTEGER NOT NULL REFERENCES survey_findings(id) ON DELETE CASCADE,
      object_url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await safe("survey_finding_photos.finding_idx", sql`
    CREATE INDEX IF NOT EXISTS survey_finding_photos_finding_idx
      ON survey_finding_photos (finding_id, sort_order)
  `);

  await seedDefaultTemplatesForOrgs();
}

async function seedDefaultTemplatesForOrgs() {
  try {
    const orgs = await db.execute(sql`SELECT id FROM organizations`);
    for (const org of orgs.rows as Array<{ id: string }>) {
      const orgId = org.id;
      if (!orgId) continue;
      const existing = await db.execute(sql`
        SELECT id FROM survey_templates WHERE organization_id = ${orgId} LIMIT 1
      `);
      if (existing.rows.length > 0) continue;

      const created = await db.execute(sql`
        INSERT INTO survey_templates (organization_id, name, description, is_default)
        VALUES (
          ${orgId},
          'Standard Site Survey',
          'Default eight-category security site survey checklist.',
          TRUE
        )
        RETURNING id
      `);
      const templateId = (created.rows[0] as { id: number } | undefined)?.id;
      if (!templateId) continue;

      for (let i = 0; i < DEFAULT_SURVEY_TEMPLATE_ITEMS.length; i++) {
        const item = DEFAULT_SURVEY_TEMPLATE_ITEMS[i];
        await db.execute(sql`
          INSERT INTO survey_template_items (template_id, category, prompt, sort_order, photo_required)
          VALUES (
            ${templateId},
            ${item.category},
            ${item.prompt},
            ${i},
            ${item.photoRequired === true}
          )
        `);
      }
      console.log(`[security-survey-migration] seeded default template for org ${orgId}`);
    }
  } catch (err) {
    console.warn(
      "[security-survey-migration] seedDefaultTemplates:",
      err instanceof Error ? err.message : err,
    );
  }
}
