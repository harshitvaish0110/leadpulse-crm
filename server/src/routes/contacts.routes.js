'use strict';
const { Router } = require('express');
const multer     = require('multer');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/contacts.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const router = Router();

router.use(authenticate);

router.get('/',              ctrl.list);
router.post('/',             ctrl.create);
router.get('/export',        ctrl.exportCSV);
router.post('/import',       upload.single('file'), ctrl.importCSV);
router.get('/:id',           ctrl.getOne);
router.patch('/:id',         ctrl.update);
router.delete('/:id',        ctrl.remove);

module.exports = router;
