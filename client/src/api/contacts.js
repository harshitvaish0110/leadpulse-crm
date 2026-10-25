import api from './axiosInstance';

export const getContacts = (params) => api.get('/api/contacts', { params });
export const getContact  = (id) => api.get(`/api/contacts/${id}`);
export const createContact = (data) => api.post('/api/contacts', data);
export const updateContact = (id, data) => api.patch(`/api/contacts/${id}`, data);
export const deleteContact = (id) => api.delete(`/api/contacts/${id}`);
