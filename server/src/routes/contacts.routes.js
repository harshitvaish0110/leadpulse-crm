'use strict';
const express    = require('express');
const { authenticate } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/contacts.controller');

const router = express.Router();
router.use(authenticate);

router.get('/',               ctrl.list);
router.post('/',              ctrl.create);
router.get('/export',         ctrl.exportCSV);
router.post('/bulk',          ctrl.bulk);
// Up to 5,000 mapped rows; larger than the default JSON limit.
router.post('/import',        express.json({ limit: '5mb' }), ctrl.importRows);
router.get('/:id',            ctrl.getOne);
router.get('/:id/snapshots',  ctrl.snapshots);
router.patch('/:id',          ctrl.update);
router.delete('/:id',         ctrl.remove);

module.exports = router;
