/**
 * LeadPulse — HTTP client for the ML service. Sends `X-ML-Token` on every call.
 */

'use strict';

const axios = require('axios');

const ml = axios.create({
  baseURL: process.env.ML_SERVICE_URL || 'http://localhost:5001',
  timeout: 10_000,
  headers: process.env.ML_SERVICE_TOKEN ? { 'X-ML-Token': process.env.ML_SERVICE_TOKEN } : {},
});

module.exports = { ml };
