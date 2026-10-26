/**
 * LeadPulse CRM — Workspace settings routes. Reads are open to every role
 * (pickers, forms and formatting need them); every write is ADMIN only.
 *
 * GET    /api/settings/workspace                    name, timezone, currency
 * PATCH  /api/settings/workspace                    ADMIN
 *
 * GET    /api/settings/pipeline-stages              board columns in order (+ dealCount for ADMIN)
 * POST   /api/settings/pipeline-stages              ADMIN  { label, color?, baseStage }
 * PUT    /api/settings/pipeline-stages/order        ADMIN  { ids }
 * PATCH  /api/settings/pipeline-stages/:id          ADMIN  { label?, color?, baseStage? }
 * DELETE /api/settings/pipeline-stages/:id          ADMIN  ?moveTo=<stage id> when it holds deals
 *
 * GET    /api/settings/tags                         (+ contactCount for ADMIN)
 * POST   /api/settings/tags                         ADMIN  { name, color?, isSource? }
 * PATCH  /api/settings/tags/:id                     ADMIN  rename (merges into an existing name), colour, lead source
 * DELETE /api/settings/tags/:id                     ADMIN  removes it from every contact
 *
 * GET    /api/settings/custom-fields?entity=        definitions in order
 * POST   /api/settings/custom-fields                ADMIN  { entity, label, type, options?, required? }
 * PUT    /api/settings/custom-fields/order          ADMIN  { entity, ids }
 * PATCH  /api/settings/custom-fields/:id            ADMIN  { label?, options?, required? }
 * DELETE /api/settings/custom-fields/:id            ADMIN  also clears its values
 *
 * GET    /api/settings/integrations                 ADMIN  key sources (never values), email, AI usage
 * PUT    /api/settings/integrations/:id             ADMIN  { apiKey } — stored encrypted
 * DELETE /api/settings/integrations/:id             ADMIN
 * POST   /api/settings/integrations/:id/test        ADMIN  { apiKey? }; also `email` and `ml`
 */

'use strict';

const { Router } = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const settings = require('../services/settings.service');
const customFields = require('../services/customFields.service');
const integrations = require('../services/integrations.service');

const router = Router();
router.use(authenticate);
const admin = requireRole('ADMIN');
const body = (req) => req.body ?? {};

router.get('/workspace', async (_req, res) => {
  res.json({ success: true, workspace: await settings.getWorkspace() });
});
router.patch('/workspace', admin, async (req, res) => {
  res.json({ success: true, workspace: await settings.updateWorkspace(req, body(req)) });
});

router.get('/pipeline-stages', async (req, res) => {
  res.json({ success: true, stages: await settings.listStages(req.user) });
});
router.post('/pipeline-stages', admin, async (req, res) => {
  res.status(201).json({ success: true, stage: await settings.createStage(req, body(req)) });
});
router.put('/pipeline-stages/order', admin, async (req, res) => {
  res.json({ success: true, stages: await settings.reorderStages(req, body(req).ids) });
});
router.patch('/pipeline-stages/:id', admin, async (req, res) => {
  res.json({ success: true, stage: await settings.updateStage(req, req.params.id, body(req)) });
});
router.delete('/pipeline-stages/:id', admin, async (req, res) => {
  res.json({ success: true, ...(await settings.removeStage(req, req.params.id, req.query.moveTo)) });
});

router.get('/tags', async (req, res) => {
  res.json({ success: true, tags: await settings.listTags(req.user) });
});
router.post('/tags', admin, async (req, res) => {
  res.status(201).json({ success: true, tag: await settings.createTag(req, body(req)) });
});
router.patch('/tags/:id', admin, async (req, res) => {
  res.json({ success: true, ...(await settings.updateTag(req, req.params.id, body(req))) });
});
router.delete('/tags/:id', admin, async (req, res) => {
  res.json({ success: true, ...(await settings.removeTag(req, req.params.id)) });
});

router.get('/custom-fields', async (req, res) => {
  res.json({ success: true, fields: await customFields.listFields(req.query.entity) });
});
router.post('/custom-fields', admin, async (req, res) => {
  res.status(201).json({ success: true, field: await customFields.createField(req, body(req)) });
});
router.put('/custom-fields/order', admin, async (req, res) => {
  res.json({ success: true, fields: await customFields.reorderFields(req, body(req).entity, body(req).ids) });
});
router.patch('/custom-fields/:id', admin, async (req, res) => {
  res.json({ success: true, field: await customFields.updateField(req, req.params.id, body(req)) });
});
router.delete('/custom-fields/:id', admin, async (req, res) => {
  res.json({ success: true, ...(await customFields.removeField(req, req.params.id)) });
});

router.get('/integrations', admin, async (_req, res) => {
  res.json({ success: true, ...(await integrations.integrationStatus()) });
});
router.put('/integrations/:id', admin, async (req, res) => {
  await integrations.saveKey(req, req.params.id, body(req).apiKey);
  res.json({ success: true, ...(await integrations.integrationStatus()) });
});
router.delete('/integrations/:id', admin, async (req, res) => {
  await integrations.removeKey(req, req.params.id);
  res.json({ success: true, ...(await integrations.integrationStatus()) });
});
router.post('/integrations/:id/test', admin, async (req, res) => {
  res.json({ success: true, result: await integrations.testIntegration(req, req.params.id, body(req).apiKey) });
});

module.exports = router;
