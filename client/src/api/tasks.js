import api from './axiosInstance';

export const getTasks = (params) => api.get('/api/tasks', { params });
export const createTask = (data) => api.post('/api/tasks', data);
export const updateTask = (id, data) => api.patch(`/api/tasks/${id}`, data);
export const completeTask = (id, completed) => api.patch(`/api/tasks/${id}/complete`, { completed });
export const deleteTask = (id) => api.delete(`/api/tasks/${id}`);
