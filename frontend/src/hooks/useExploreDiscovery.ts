import { useRef, useState } from 'react';
import api, { getErrorMessage } from '../services/api';
import type {
  ExploreDiscoveryResponse,
  ExplorePlannerRequest,
  ParsedExploreIntent,
} from '../types/explore';

const createDraft = (): ExplorePlannerRequest => ({
  city: '',
  datePreset: 'weekend',
  indoorPreference: 'any',
  experienceKeys: ['any'],
});

export const useExploreDiscovery = () => {
  const [draft, setDraft] = useState<ExplorePlannerRequest>(createDraft);
  const [parsed, setParsed] = useState<ParsedExploreIntent | null>(null);
  const [response, setResponse] = useState<ExploreDiscoveryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controllerRef = useRef<AbortController | null>(null);

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  };

  const request = async <T,>(url: string, body: ExplorePlannerRequest = draft): Promise<T> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await api.post<T>(url, body, { signal: controller.signal });
      return result.data;
    } catch (requestError: unknown) {
      if (!controller.signal.aborted) setError(getErrorMessage(requestError, 'explore_discovery_failed'));
      throw requestError;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  };

  const preview = async () => {
    const result = await request<ParsedExploreIntent>('/parent/explore/discovery/preview-intent');
    setParsed(result);
    return result;
  };

  const search = async (nextDraft: ExplorePlannerRequest = draft) => {
    const result = await request<ExploreDiscoveryResponse>('/parent/explore/discovery/search', nextDraft);
    setParsed(result.intent);
    setResponse(result);
    return result;
  };

  return {
    draft,
    setDraft,
    preview,
    search,
    cancel,
    parsed,
    results: response?.results || [],
    adjustments: response?.adjustments || [],
    partial: response?.partial || false,
    loading,
    error,
  };
};
