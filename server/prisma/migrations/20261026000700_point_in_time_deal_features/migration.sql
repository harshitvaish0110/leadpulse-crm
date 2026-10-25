-- Win-probability training rows must look like the open deals the model scores.
-- Describing a closed deal at its close date leaked the outcome: the final week
-- is busy and the deal has just changed stage, while an open deal is described
-- as of today. Closed deals are now described at a point between 35 % and 85 % of
-- their life (fixed per deal, from its id, so training is reproducible), using only
-- the stage history and activities known at that moment. Open deals are unchanged:
-- described as of NOW().

CREATE OR REPLACE VIEW ml_deal_features AS
WITH asof AS (
  SELECT
    d."id",
    CASE WHEN d."stage" IN ('CLOSED_WON', 'CLOSED_LOST') AND d."closedAt" IS NOT NULL
      THEN d."createdAt" + (d."closedAt" - d."createdAt") * (0.35 + 0.5 * (abs(hashtext(d."id")) % 1000) / 1000.0)
      ELSE NOW()
    END AS at
  FROM "deals" d
)
SELECT
  d."id",
  d."stage"::text                                                          AS stage,
  (d."stage" IN ('CLOSED_WON', 'CLOSED_LOST'))::int                         AS is_closed,
  (d."stage" = 'CLOSED_WON')::int                                           AS won,
  COALESCE(h.max_ordinal, lp_stage_ordinal(d."stage"), 0)                   AS stage_ordinal,
  d."value"::float                                                          AS deal_value,
  GREATEST(EXTRACT(EPOCH FROM (t.at - COALESCE(h.entered_at, d."createdAt"))) / 86400.0, 0)::float AS days_in_current_stage,
  COALESCE(a.total, 0)::int                                                 AS total_activities,
  COALESCE(a.last7, 0)::int                                                 AS activity_last_7d,
  lp_title_seniority(c."title")                                             AS contact_seniority,
  COALESCE(co."size", 50)::int                                              AS company_size
FROM "deals" d
JOIN asof t              ON t."id" = d."id"
JOIN "contacts" c        ON c."id" = d."contactId"
LEFT JOIN "companies" co ON co."id" = c."companyId"
LEFT JOIN LATERAL (
  SELECT MAX(lp_stage_ordinal(x."toStage")) AS max_ordinal,
         MAX(x."changedAt")                 AS entered_at
  FROM "deal_stage_history" x
  WHERE x."dealId" = d."id" AND x."changedAt" <= t.at
) h ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE y."occurredAt" > t.at - INTERVAL '7 days') AS last7
  FROM "activities" y
  WHERE y."dealId" = d."id" AND y."occurredAt" <= t.at
) a ON TRUE;
