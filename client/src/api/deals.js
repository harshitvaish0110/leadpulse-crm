import api from './axiosInstance';

export const getDeals = (params) => api.get('/api/deals', { params });
export const getDeal  = (id) => api.get(`/api/deals/${id}`);
export const createDeal = (data) => api.post('/api/deals', data);
export const updateDeal = (id, data) => api.patch(`/api/deals/${id}`, data);
export const updateDealStage = (id, stage) => api.patch(`/api/deals/${id}/stage`, { stage });
/** Move to a pipeline column: `{ pipelineStageId, lostReason? }`. */
export const moveDeal = (id, body) => api.patch(`/api/deals/${id}/stage`, body);
export const getDealHistory = (id) => api.get(`/api/deals/${id}/history`);
export const deleteDeal = (id) => api.delete(`/api/deals/${id}`);
