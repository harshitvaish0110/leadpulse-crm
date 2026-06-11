import api from './axiosInstance';

export const getOverview = () => api.get('/api/analytics/overview');
export const getRevenue = () => api.get('/api/analytics/revenue');
export const getPipeline = () => api.get('/api/analytics/pipeline');
export const getWinLoss = () => api.get('/api/analytics/win-loss');
export const getRepPerformance = () => api.get('/api/analytics/rep-performance');
export const getSentimentTrends = () => api.get('/api/analytics/sentiment-trends');
