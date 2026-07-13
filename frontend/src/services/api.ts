import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { isGrowthIdentity, type GrowthIdentity, type GrowthProfileUpdate } from '../types/growthIdentity';

export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: unknown;
}

interface ExtendedAxiosConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const RETRY_STATUS_CODES = [503, 504, 429];

const isNetworkError = (error: AxiosError): boolean => {
  return !error.response && (
    error.code === 'ERR_NETWORK' ||
    error.code === 'ECONNABORTED' ||
    error.message?.includes('Network Error') ||
    error.message?.includes('timeout')
  );
};

let redirectingToLogin = false;

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const config = error.config as ExtendedAxiosConfig | undefined;
    const url = config?.url || 'unknown';
    const method = config?.method?.toUpperCase() || 'unknown';
    const status = error.response?.status;
    const errorMsg = error.response?.data?.message || error.message;

    if (import.meta.env.DEV) {
      console.error(`[API Error] ${method} ${url}`, {
        status,
        message: errorMsg,
        data: error.response?.data,
      });
    }

    if (isNetworkError(error)) {
      console.error('[API] Network connection failed');
    }

    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('quick_login_token');
      localStorage.removeItem('quick_login_user');
      localStorage.removeItem('quick_login_expires_at');
      window.dispatchEvent(new Event('auth:logout'));

      if (window.location.pathname !== '/login' && !redirectingToLogin) {
        redirectingToLogin = true;
        window.location.href = '/login';
      }

      return Promise.reject(error);
    }

    if (
      config &&
      !config._retry &&
      config.method === 'get' &&
      (RETRY_STATUS_CODES.includes(status || 0) ||
        error.code === 'ECONNABORTED' ||
        error.message?.includes('timeout'))
    ) {
      config._retry = true;
      config._retryCount = (config._retryCount || 0) + 1;

      if (config._retryCount <= 2) {
        const delay = config._retryCount * 1000;
        await new Promise(resolve => window.setTimeout(resolve, delay));
        return api.request(config);
      }
    }

    return Promise.reject(error);
  }
);

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || '请求失败';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '未知错误';
};

export const isAuthError = (error: unknown): boolean => {
  return axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403);
};

export const getChildGrowthIdentity = async (): Promise<GrowthIdentity> => {
  const response = await api.get<GrowthIdentity>('/child/growth-identity');
  if (!isGrowthIdentity(response.data)) throw new Error('Invalid growth identity response');
  return response.data;
};

export const updateChildProfileCustomization = async (selection: GrowthProfileUpdate): Promise<GrowthIdentity> => {
  const response = await api.put<GrowthIdentity>('/child/profile-customization', selection);
  if (!isGrowthIdentity(response.data)) throw new Error('Invalid growth identity response');
  return response.data;
};

export default api;
