-- ML feature views: the single source of feature definitions for both training
-- (ml-service/train.py) and serving (the API sends these rows to the ML service).
-- Lateral subqueries keep exactly one row per entity.

CREATE OR REPLACE FUNCTION lp_stage_ordinal(s "DealStage") RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE s
    WHEN 'LEAD'        THEN 0
    WHEN 'CONTACTED'   THEN 1
    WHEN 'DEMO'        THEN 2
    WHEN 'PROPOSAL'    THEN 3
    WHEN 'NEGOTIATION' THEN 4
    ELSE NULL
  END
$$;

-- Title heuristic: 3 = C-level/VP/founder, 2 = director/head, 1 = manager/lead/senior, 0 = other.
CREATE OR REPLACE FUNCTION lp_title_seniority(t TEXT) RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN t ~* '(chief|\mceo\M|\mcto\M|\mcfo\M|\mcoo\M|\mcmo\M|\mvp\M|vice president|founder|owner|president)' THEN 3
    WHEN t ~* '(director|head of)'                                                                       THEN 2
    WHEN t ~* '(manager|\mlead\M|principal|senior)'                                                     THEN 1
    ELSE 0
  END
$$;

CREATE OR REPLACE VIEW ml_contact_features AS
SELECT
  c."id",
  c."status"::text                                                        AS status,
  COALESCE(EXTRACT(EPOCH FROM (NOW() - a.last_at)) / 86400.0, 999)::float  AS days_since_last_contact,
  COALESCE(a.cnt_30, 0)::int                                              AS activity_count_30d,
  COALESCE(a.cnt_90, 0)::int                                              AS activity_count_90d,
  COALESCE(c."sentimentScore", 0.5)::float                                AS avg_sentiment,
  COALESCE(d.deal_count, 0)::int                                          AS deal_count,
  COALESCE(d.total_value, 0)::float                                       AS total_deal_value,
  COALESCE(d.has_open, 0)::int                                            AS has_open_deal
FROM "contacts" c
LEFT JOIN LATERAL (
  SELECT MAX(x."occurredAt")                                                     AS last_at,
         COUNT(*) FILTER (WHERE x."occurredAt" > NOW() - INTERVAL '30 days')     AS cnt_30,
         COUNT(*) FILTER (WHERE x."occurredAt" > NOW() - INTERVAL '90 days')     AS cnt_90
  FROM "activities" x
  WHERE x."contactId" = c."id"
) a ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*)                                                                AS deal_count,
         SUM(y."value")                                                          AS total_value,
         MAX(CASE WHEN y."stage" NOT IN ('CLOSED_WON', 'CLOSED_LOST') THEN 1 ELSE 0 END) AS has_open
  FROM "deals" y
  WHERE y."contactId" = c."id"
) d ON TRUE;

-- Closed deals are described as of "closedAt" (training rows); open deals as of NOW() (serving rows).
CREATE OR REPLACE VIEW ml_deal_features AS
SELECT
  d."id",
  d."stage"::text                                                          AS stage,
  (d."stage" IN ('CLOSED_WON', 'CLOSED_LOST'))::int                         AS is_closed,
  (d."stage" = 'CLOSED_WON')::int                                           AS won,
  COALESCE(GREATEST(h.max_open_ordinal, lp_stage_ordinal(d."stage")), 0)    AS stage_ordinal,
  d."value"::float                                                          AS deal_value,
  GREATEST(
    EXTRACT(EPOCH FROM (COALESCE(d."closedAt", NOW())
      - COALESCE(h.last_open_at, d."stageChangedAt", d."createdAt"))) / 86400.0,
    0
  )::float                                                                  AS days_in_current_stage,
  COALESCE(a.total, 0)::int                                                 AS total_activities,
  COALESCE(a.last7, 0)::int                                                 AS activity_last_7d,
  lp_title_seniority(c."title")                                             AS contact_seniority,
  COALESCE(co."size", 50)::int                                              AS company_size
FROM "deals" d
JOIN "contacts" c        ON c."id" = d."contactId"
LEFT JOIN "companies" co ON co."id" = c."companyId"
LEFT JOIN LATERAL (
  SELECT MAX(lp_stage_ordinal(h."toStage"))                                                  AS max_open_ordinal,
         MAX(h."changedAt") FILTER (WHERE lp_stage_ordinal(h."toStage") IS NOT NULL)         AS last_open_at
  FROM "deal_stage_history" h
  WHERE h."dealId" = d."id"
) h ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (
           WHERE x."occurredAt" >  COALESCE(d."closedAt", NOW()) - INTERVAL '7 days'
             AND x."occurredAt" <= COALESCE(d."closedAt", NOW())
         ) AS last7
  FROM "activities" x
  WHERE x."dealId" = d."id"
) a ON TRUE;
