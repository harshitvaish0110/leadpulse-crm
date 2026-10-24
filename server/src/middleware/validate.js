'use strict';

const { validationResult } = require('express-validator');
const { ApiError } = require('./error.middleware');

/**
 * Runs express-validator chains and rejects with 422 VALIDATION_ERROR.
 * @example router.post('/', validate([body('email').isEmail()]), handler)
 */
const validate = (rules) => [
  ...rules,
  (req, _res, next) => {
    const errors = validationResult(req);
    next(errors.isEmpty() ? undefined : ApiError.validation(errors.array()));
  },
];

module.exports = { validate };
