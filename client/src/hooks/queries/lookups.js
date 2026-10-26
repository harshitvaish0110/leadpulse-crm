import { useQuery } from '@tanstack/react-query';
import api from '../../api/axiosInstance';
import { qk } from './keys';

/** Reference data shared by filters and pickers; it rarely changes, so it stays fresh for 5 minutes. */
const lookup = (queryKey, url, pick) => ({
  queryKey,
  queryFn: () => api.get(url).then((r) => pick(r.data)),
  staleTime: 5 * 60_000,
});

/** Active users: `{ id, firstName, lastName, role }[]`. */
export const useDirectory = () => useQuery(lookup(qk.users.directory, '/api/users/directory', (d) => d.users));

/** Tags: `{ id, name, color, isSource }[]`. */
export const useTags = () => useQuery(lookup(qk.settings.tags, '/api/settings/tags', (d) => d.tags));

/** Pipeline stages in board order: `{ id, label, color, baseStage, position }[]`. */
export const usePipelineStages = () => useQuery(lookup(qk.settings.stages, '/api/settings/pipeline-stages', (d) => d.stages));

/** Workspace name, timezone and currency. */
export const useWorkspace = () => useQuery(lookup(qk.settings.workspace, '/api/settings/workspace', (d) => d.workspace));

/** Custom field definitions for 'CONTACT' or 'DEAL', in display order. */
export const useCustomFields = (entity) => useQuery(lookup(qk.settings.customFields(entity), `/api/settings/custom-fields?entity=${entity}`, (d) => d.fields));

/** Distinct company industries. */
export const useIndustries = () => useQuery(lookup(['companies', 'industries'], '/api/companies/industries', (d) => d.industries));
