/** Enum values mirrored from server/prisma/schema.prisma. Keep them in sync. */

export const CONTACT_STATUSES = ['LEAD', 'ACTIVE', 'INACTIVE', 'CHURNED'];

export const DEAL_STAGES = ['LEAD', 'CONTACTED', 'DEMO', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST'];
export const OPEN_DEAL_STAGES = DEAL_STAGES.slice(0, 5);

export const ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE', 'TRANSCRIPT'];
/** Types a user can log by hand (transcripts come from call recordings). */
export const LOGGABLE_ACTIVITY_TYPES = ['CALL', 'EMAIL', 'MEETING', 'NOTE'];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];

export const ROLES = ['ADMIN', 'MANAGER', 'SALES_REP'];

export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'AT_RISK'];

export const SCORE_LABELS = ['HOT', 'WARM', 'COLD'];
