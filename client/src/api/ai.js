import api from './axiosInstance';

export const composeEmail = (data) => api.post('/api/ai/compose-email', data);
export const dealSummary = (id) => api.post(`/api/ai/deal-summary/${id}`);
export const smartReply = (data) => api.post('/api/ai/smart-reply', data);
export const nextAction = (id) => api.post(`/api/ai/next-action/${id}`);
export const enrichContact = (data) => api.post('/api/ai/enrich-contact', data);
export const chat = (params) => api.get('/api/ai/chat', { params });
export const transcribeAudio = (data) => api.post('/api/ai/transcribe', data);
