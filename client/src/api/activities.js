import api from './axiosInstance';

export const getActivities = (params) => api.get('/api/activities', { params });
export const getActivity  = (id) => api.get(`/api/activities/${id}`);
export const createActivity = (data) => api.post('/api/activities', data);
export const deleteActivity = (id) => api.delete(`/api/activities/${id}`);
export const uploadAudio = (file, data) => {
  const form = new FormData();
  form.append('file', file);
  if (data?.contactId) form.append('contactId', data.contactId);
  if (data?.dealId) form.append('dealId', data.dealId);
  return api.post('/api/activities/upload-audio', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
