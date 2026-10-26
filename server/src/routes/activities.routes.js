'use strict';

const { Router } = require('express');
const multer  = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const { ApiError } = require('../middleware/error.middleware');
const ctrl    = require('../controllers/activities.controller');

const router = Router();
router.use(authenticate);

const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/webm', 'audio/ogg', 'audio/flac']);

// Kept in memory, then written under a random key by the storage adapter; the client's file name is never used.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (AUDIO_TYPES.has(file.mimetype.split(';')[0])
    ? cb(null, true)
    : cb(new ApiError(`Unsupported audio format: ${file.mimetype}`, 415, 'UNSUPPORTED_MEDIA_TYPE'))),
});

router.get('/',        ctrl.list);
router.post('/',       ctrl.create);
router.post('/upload-audio', audioUpload.single('audio'), ctrl.uploadAudio);
router.get('/:id',     ctrl.getOne);
router.delete('/:id',  ctrl.remove);
router.post('/:id/retry-transcription', ctrl.retryTranscription);
router.get('/:id/audio-url', ctrl.audioUrl);

module.exports = router;
