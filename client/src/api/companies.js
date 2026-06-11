import api from './axiosInstance';

export const getCompanies = (params) => api.get('/api/companies', { params });
export const getCompany  = (id) => api.get(`/api/companies/${id}`);
export const createCompany = (data) => api.post('/api/companies', data);
export const updateCompany = (id, data) => api.patch(`/api/companies/${id}`, data);
export const deleteCompany = (id) => api.delete(`/api/companies/${id}`);
