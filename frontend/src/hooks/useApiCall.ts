import { useState, useCallback } from 'react';
import api from '../services/api';

interface ApiCallOptions {
  successMessage?: string;
  errorMessage?: string;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
  showSuccessAlert?: boolean;
  showErrorAlert?: boolean;
}

export function useApiCall() {
  const [loading, setLoading] = useState(false);

  const call = useCallback(async <T = any>(
    method: 'get' | 'post' | 'put' | 'delete',
    url: string,
    data?: any,
    options: ApiCallOptions = {}
  ): Promise<T | null> => {
    const {
      successMessage,
      errorMessage = '操作失败，请重试',
      onSuccess,
      onError,
      showSuccessAlert = !!successMessage,
      showErrorAlert = true,
    } = options;

    try {
      setLoading(true);
      let response;
      switch (method) {
        case 'get': response = await api.get(url); break;
        case 'post': response = await api.post(url, data); break;
        case 'put': response = await api.put(url, data); break;
        case 'delete': response = await api.delete(url); break;
      }
      if (showSuccessAlert && successMessage) alert(successMessage);
      onSuccess?.(response.data);
      return response.data as T;
    } catch (err: any) {
      const msg = err.response?.data?.message || errorMessage;
      if (showErrorAlert) alert(msg);
      onError?.(err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const get = useCallback(<T = any>(url: string, options?: ApiCallOptions) => call<T>('get', url, undefined, options), [call]);
  const post = useCallback(<T = any>(url: string, data?: any, options?: ApiCallOptions) => call<T>('post', url, data, options), [call]);
  const put = useCallback(<T = any>(url: string, data?: any, options?: ApiCallOptions) => call<T>('put', url, data, options), [call]);
  const del = useCallback(<T = any>(url: string, options?: ApiCallOptions) => call<T>('delete', url, undefined, options), [call]);

  return { loading, call, get, post, put, del };
}

export function useApiData<T>(url: string, defaultValue: T) {
  const [data, setData] = useState<T>(defaultValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(url);
      setData(response.data);
    } catch (err: any) {
      const msg = err.response?.data?.message || '加载失败';
      setError(msg);
      console.error(`Failed to fetch ${url}:`, err);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const refresh = useCallback(() => { fetch(); }, [fetch]);

  return { data, setData, loading, error, fetch, refresh };
}

export default useApiCall;
