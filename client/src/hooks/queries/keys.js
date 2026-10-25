/**
 * Query keys. Every key starts with its domain, so invalidating the domain
 * (e.g. `qk.deals.all`) refreshes its lists, board and detail views together.
 */
export const qk = {
  contacts: {
    all: ['contacts'],
    list: (params) => ['contacts', 'list', params],
    options: ['contacts', 'options'],
    detail: (id) => ['contacts', 'detail', id],
  },
  companies: {
    all: ['companies'],
    list: (params) => ['companies', 'list', params],
    options: ['companies', 'options'],
    detail: (id) => ['companies', 'detail', id],
  },
  deals: {
    all: ['deals'],
    kanban: (params) => ['deals', 'kanban', params],
    list: (params) => ['deals', 'list', params],
    detail: (id) => ['deals', 'detail', id],
  },
  activities: {
    all: ['activities'],
    list: (params) => ['activities', 'list', params],
  },
  tasks: {
    all: ['tasks'],
    list: (params) => ['tasks', 'list', params],
  },
  analytics: {
    all: ['analytics'],
    report: (name, params) => ['analytics', name, params],
  },
  users: {
    all: ['users'],
    directory: ['users', 'directory'],
  },
};
