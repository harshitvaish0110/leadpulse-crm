import { useQuery } from '@tanstack/react-query';
import api from '../../api/axiosInstance';

/** Reference data shared by filters and pickers; it rarely changes, so it stays fresh for 5 minutes. */
const lookup = (queryKey, url, pick) => ({
  queryKey,
  queryFn: () => api.get(url).then((r) => pick(r.data)),
  staleTime: 5 * 60_000,
});

/** Active users: `{ id, firstName, lastName, role }[]`. */
export const useDirectory = () => useQuery(lookup(['users', 'directory'], '/api/users/directory', (d) => d.users));

/** Tags: `{ id, name, color, isSource }[]`. */
export const useTags = () => useQuery(lookup(['settings', 'tags'], '/api/settings/tags', (d) => d.tags));

/** Pipeline stages in board order: `{ id, label, color, baseStage, position }[]`. */
export const usePipelineStages = () => useQuery(lookup(['settings', 'pipeline-stages'], '/api/settings/pipeline-stages', (d) => d.stages));

/** Distinct company industries. */
export const useIndustries = () => useQuery(lookup(['companies', 'industries'], '/api/companies/industries', (d) => d.industries));
