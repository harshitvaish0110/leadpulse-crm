-- Tags used on contacts but missing from the tags table (they were only added
-- there by bulk tagging), so the tag manager lists every tag in use.
INSERT INTO "tags" ("id", "name")
SELECT gen_random_uuid()::text, t.name
FROM (SELECT DISTINCT unnest("tags") AS name FROM "contacts") t
ON CONFLICT ("name") DO NOTHING;
