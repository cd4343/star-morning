import axios, { AxiosError } from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000, // 增加到15秒，给数据库排队留时间
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

// 响应拦截器：处理错误和自动重试
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as any;
    
    // Token 过期处理
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
      return Promise.reject(error);
    }
    
    // 自动重试逻辑（针对写操作的数据库繁忙）
    if (
      config &&
      !config._retry &&
      config.method !== 'get' && // 只对写操作重试
      (RETRY_STATUS_CODES.includes(error.response?.status || 0) ||
       error.code === 'ECONNABORTED' || // 超时
       error.message?.includes('timeout'))
    ) {
      config._retry = true;
      config._retryCount = (config._retryCount || 0) + 1;
      
      // 最多重试 2 次
      if (config._retryCount <= 2) {
        // 延迟重试（指数退避：1秒、2秒）
        const delay = config._retryCount * 1000;
        console.log(`[API] 请求失败，${delay/1000}秒后重试... (${config._retryCount}/2)`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return api.request(config);
      }
    }
    
    return Promise.reject(error);
  }
);

export default api;
