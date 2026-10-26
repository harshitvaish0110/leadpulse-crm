import api from './axiosInstance';

export const getActivities = (params) => api.get('/api/activities', { params });
export const getActivity  = (id) => api.get(`/api/activities/${id}`);
export const createActivity = (data) => api.post('/api/activities', data);
export const deleteActivity = (id) => api.delete(`/api/activities/${id}`);

/** Uploads a call recording (multipart field `audio`); the transcript arrives later over the socket. */
export const uploadAudio = (file, { contactId, dealId, occurredAt } = {}, onProgress) => {
  const form = new FormData();
  form.append('audio', file);
  if (contactId) form.append('contactId', contactId);
  if (dealId) form.append('dealId', dealId);
  if (occurredAt) form.append('occurredAt', occurredAt);
  return api.post('/api/activities/upload-audio', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : null),
  });
};
export const retryTranscription = (id) => api.post(`/api/activities/${id}/retry-transcription`);
export const getAudioUrl = (id) => api.get(`/api/activities/${id}/audio-url`);
