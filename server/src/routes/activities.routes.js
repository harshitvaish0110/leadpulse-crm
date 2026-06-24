'use strict';

const path    = require('path');
const fs      = require('fs');
const { Router } = require('express');
const multer  = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl    = require('../controllers/activities.controller');

const router = Router();
router.use(authenticate);

// ── Multer config for audio uploads ─────────────────────────────────────────
const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'audio');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const audioStorage = multer.diskStorage({
  destination: uploadDir,
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const audioUpload = multer({
  storage:    audioStorage,
  limits:     { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/webm', 'audio/ogg', 'audio/flac', 'audio/x-m4a'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`), false);
    }
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────
router.get('/',        ctrl.list);
router.post('/',       ctrl.create);
router.get('/:id',     ctrl.getOne);
router.delete('/:id',  ctrl.remove);

// Audio transcription — uses multer for multipart/form-data
router.post('/upload-audio', audioUpload.single('audio'), ctrl.uploadAudio);

module.exports = router;
