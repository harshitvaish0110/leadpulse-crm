import api from './axiosInstance';

export const getOverview = () => api.get('/api/analytics/overview');
export const getRevenue = () => api.get('/api/analytics/revenue');
export const getPipeline = () => api.get('/api/analytics/pipeline');
export const getAtRisk = (params) => api.get('/api/analytics/at-risk', { params });
