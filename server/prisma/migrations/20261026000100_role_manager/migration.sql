-- New role between ADMIN and SALES_REP: full CRM access, no workspace administration.
-- Kept in its own migration: a newly added enum value cannot be used in the same transaction.
ALTER TYPE "Role" ADD VALUE 'MANAGER';
