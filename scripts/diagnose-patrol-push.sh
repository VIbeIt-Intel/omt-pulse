#!/usr/bin/env bash
# Read-only diagnostic: does the "Patroller 1" position (and patrol users)
# have a push token so patrol-due/overdue alerts can actually be delivered?
set -euo pipefail
DB_NAME="${DB_NAME:-omt_pulse}"
NAME_FILTER="${NAME_FILTER:-patrol}"

echo "=== Patrol / position workstations ==="
sudo -u postgres psql -d "$DB_NAME" -x -c "
  SELECT w.id, w.name, w.type, w.is_active,
         w.position_user_id, w.current_operator_user_id,
         w.device_token IS NOT NULL AS enrolled,
         w.last_seen_at
  FROM workstations w
  WHERE w.type = 'patrol' OR w.name ILIKE '%${NAME_FILTER}%'
  ORDER BY w.name;
"

echo "=== Users that patrol pushes target (role patrol_user or name/position match) ==="
echo "    fcm_tokens = native APK push, web_subs = PWA push. Need >=1 to receive alerts."
sudo -u postgres psql -d "$DB_NAME" -x -c "
  WITH candidates AS (
    SELECT u.id, u.first_name, u.last_name, u.email, u.role, u.is_active, o.name AS org_name
    FROM users u
    LEFT JOIN organizations o ON o.id = u.organization_id
    WHERE u.role = 'patrol_user'
       OR u.first_name ILIKE '%${NAME_FILTER}%'
       OR u.last_name ILIKE '%${NAME_FILTER}%'
       OR u.id IN (
         SELECT position_user_id FROM workstations
         WHERE position_user_id IS NOT NULL
           AND (type = 'patrol' OR name ILIKE '%${NAME_FILTER}%')
         UNION
         SELECT current_operator_user_id FROM workstations
         WHERE current_operator_user_id IS NOT NULL
           AND (type = 'patrol' OR name ILIKE '%${NAME_FILTER}%')
       )
  )
  SELECT c.first_name || ' ' || c.last_name AS name,
         c.role, c.is_active, c.org_name,
         (SELECT count(*) FROM fcm_tokens f WHERE f.user_id = c.id)          AS fcm_tokens,
         (SELECT max(f.created_at) FROM fcm_tokens f WHERE f.user_id = c.id) AS last_fcm_at,
         (SELECT count(*) FROM push_subscriptions p WHERE p.user_id = c.id)  AS web_subs
  FROM candidates c
  ORDER BY name;
"

echo "=== Verdict ==="
sudo -u postgres psql -d "$DB_NAME" -t -A -c "
  WITH candidates AS (
    SELECT u.id
    FROM users u
    WHERE u.role = 'patrol_user'
       OR u.first_name ILIKE '%${NAME_FILTER}%'
       OR u.last_name ILIKE '%${NAME_FILTER}%'
       OR u.id IN (
         SELECT position_user_id FROM workstations WHERE position_user_id IS NOT NULL
         UNION
         SELECT current_operator_user_id FROM workstations WHERE current_operator_user_id IS NOT NULL
       )
  )
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM candidates c
    WHERE EXISTS (SELECT 1 FROM fcm_tokens f WHERE f.user_id = c.id)
       OR EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = c.id)
  ) THEN 'OK: at least one patrol target has a push token'
    ELSE 'PROBLEM: no patrol target has any push token — patrol alerts will NOT be delivered' END;
"
