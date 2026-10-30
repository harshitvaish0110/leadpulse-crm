/**
 * LeadPulse CRM — Attachments on deals or contacts (private files, signed download links).
 *
 * GET    /api/attachments?dealId=|contactId=
 * POST   /api/attachments            multipart: file (≤ 10 MB), dealId or contactId
 * GET    /api/attachments/:id/url    { url, expiresAt }
 * DELETE /api/attachments/:id
 */

'use strict';

const { Router } = require('express');
const multer = require('multer');
const { prisma } = require('../lib/prisma');
const storage = require('../lib/storage');
const { ApiError } = require('../middleware/error.middleware');
const { authenticate, scoped, scopeFor, assertInScope, assertContactInScope } = require('../middleware/auth.middleware');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf', 'text/plain', 'text/csv',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const type = file.mimetype.split(';')[0];
    cb(ALLOWED_TYPES.has(type) ? null : ApiError.validation([{ path: 'file', msg: `File type ${type} is not allowed` }]), ALLOWED_TYPES.has(type));
  },
});

const SELECT = {
  id: true, fileName: true, mimeType: true, sizeBytes: true, dealId: true, contactId: true, createdAt: true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
};

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const { dealId, contactId } = req.query;
  if (!dealId && !contactId) throw ApiError.badRequest('dealId or contactId is required');
  const attachments = await prisma.attachment.findMany({
    where:   scoped(req.user, 'attachment', { ...(dealId && { dealId }), ...(contactId && { contactId }) }),
    orderBy: { createdAt: 'desc' },
    select:  SELECT,
  });
  res.json({ success: true, attachments });
});

router.post('/', upload.single('file'), async (req, res) => {
  const { dealId, contactId } = req.body ?? {};
  if (!req.file) throw ApiError.badRequest('No file uploaded (field "file")');
  if (!dealId === !contactId) throw ApiError.badRequest('Provide exactly one of dealId or contactId');
  if (dealId) await assertInScope(req.user, 'deal', dealId);
  else await assertContactInScope(req.user, contactId);

  const key = storage.newKey('attachment', req.file.originalname);
  await storage.put(key, req.file.buffer, req.file.mimetype.split(';')[0]);
  try {
    const attachment = await prisma.attachment.create({
      data: {
        dealId: dealId || null, contactId: contactId || null,
        fileName: (req.file.originalname || 'file').slice(0, 200),
        mimeType: req.file.mimetype.split(';')[0], sizeBytes: req.file.size,
        storageKey: key, uploadedById: req.user.id,
      },
      select: SELECT,
    });
    res.status(201).json({ success: true, attachment });
  } catch (err) {
    await storage.remove(key);
    throw err;
  }
});

router.get('/:id/url', async (req, res) => {
  const attachment = await prisma.attachment.findFirst({
    where:  { id: req.params.id, ...scopeFor(req.user, 'attachment') },
    select: { storageKey: true, fileName: true },
  });
  if (!attachment) throw ApiError.notFound('Attachment not found');
  res.json({ success: true, ...(await storage.signedUrl(attachment.storageKey, attachment.fileName)) });
});

router.delete('/:id', async (req, res) => {
  const attachment = await prisma.attachment.delete({
    where:  { id: req.params.id, ...scopeFor(req.user, 'attachment') },
    select: { storageKey: true },
  });
  await storage.remove(attachment.storageKey);
  res.status(204).end();
});

module.exports = router;
