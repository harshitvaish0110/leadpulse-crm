import api from './axiosInstance';

export const getContacts = (params) => api.get('/api/contacts', { params });
export const getContact  = (id) => api.get(`/api/contacts/${id}`);
export const createContact = (data) => api.post('/api/contacts', data);
export const updateContact = (id, data) => api.patch(`/api/contacts/${id}`, data);
export const deleteContact = (id) => api.delete(`/api/contacts/${id}`);
export const exportContacts = () => api.get('/api/contacts/export', { responseType: 'blob' });
export const importContacts = (file) => {
  const form = new FormData();
  form.append('file', file);
  return api.post('/api/contacts/import', form, { headers: { 'Content-Type': 'multipart/form-data' } });
};
