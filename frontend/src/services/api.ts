import axios, { AxiosError, AxiosRequestConfig } from 'axios';

// API 错误响应类型
export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: unknown;
}

// 扩展 AxiosRequestConfig 以支持重试配置
interface ExtendedAxiosConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _retryCount?: number;
}

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000, // 15秒超时，给数据库排队留时间
});

// 请求拦截器：自动添加 Token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 需要重试的状态码
const RETRY_STATUS_CODES = [503, 504, 429]; // 服务不可用、网关超时、请求过多

// 检查是否为网络错误
const isNetworkError = (error: AxiosError): boolean => {
  return !error.response && (
    error.code === 'ERR_NETWORK' ||
    error.code === 'ECONNABORTED' ||
    error.message?.includes('Network Error') ||
    error.message?.includes('timeout')
  );
};

// 响应拦截器：处理错误和自动重试
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const config = error.config as ExtendedAxiosConfig;
    const url = config?.url || 'unknown';
    const method = config?.method?.toUpperCase() || 'unknown';
    const status = error.response?.status;
    const errorMsg = error.response?.data?.message || error.message;
    
    // 开发环境打印详细错误信息
    if (process.env.NODE_ENV === 'development') {
      console.error(`[API Error] ${method} ${url}`, {
        status,
        message: errorMsg,
        data: error.response?.data
      });
    }
    
    // 网络错误处理
    if (isNetworkError(error)) {
      console.error('[API] 网络连接失败');
      // 可以在这里触发全局网络错误提示
    }
    
    // Token 过期处理
    if (status === 401) {
      console.warn('[API] Token 过期，跳转登录页...');
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      // 避免在登录页面循环跳转
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
    
    // 自动重试逻辑（针对写操作的数据库繁忙或网络问题）
    if (
      config &&
      !config._retry &&
      config.method !== 'get' && // 只对写操作重试
      (RETRY_STATUS_CODES.includes(status || 0) ||
       error.code === 'ECONNABORTED' ||
       error.message?.includes('timeout'))
    ) {
      config._retry = true;
      config._retryCount = (config._retryCount || 0) + 1;
      
      // 最多重试 2 次
      if (config._retryCount <= 2) {
        // 延迟重试（指数退避：1秒、2秒）
        const delay = config._retryCount * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return api.request(config);
      }
    }
    
    return Promise.reject(error);
  }
);

// 辅助函数：提取错误消息
export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message || error.message || '请求失败';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '未知错误';
};

export default api;
