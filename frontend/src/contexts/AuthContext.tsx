import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import api from '../services/api';

interface User {
  id: string;
  name: string;
  role: 'parent' | 'child';
  familyId: string;
  coins?: number;
  xp?: number;
  level?: number;
  privilegePoints?: number;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user?: User) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // 直接从 localStorage 初始化状态（无需等待）
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<User | null>(() => {
    try {
      const storedUser = localStorage.getItem('user');
      return storedUser ? JSON.parse(storedUser) : null;
    } catch {
      // JSON 解析失败，清除损坏的数据
      localStorage.removeItem('user');
      return null;
    }
  });
  
  // isLoading 仅用于首次加载时的短暂验证
  // 策略：先显示界面，后台验证 token
  const [isLoading, setIsLoading] = useState(false);
  const validationDone = useRef(false);

  useEffect(() => {
    // 仅首次挂载时后台验证 token
    if (validationDone.current) return;
    validationDone.current = true;
    
    const validateTokenInBackground = async () => {
      const storedToken = localStorage.getItem('token');
      if (!storedToken) return;
      
      try {
        // 后台静默验证 - 不阻塞界面
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('timeout')), 8000);
        });
        
        await Promise.race([
          api.get('/auth/members'),
          timeoutPromise
        ]);
        // Token 有效，无需操作
      } catch (err: any) {
        // 只有确定 token 无效（401/403）才清除，超时/网络错误不清除
        if (err.response?.status === 401 || err.response?.status === 403) {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          setToken(null);
          setUser(null);
        }
        // 超时和网络错误保持现有登录状态
      }
    };
    
    validateTokenInBackground();
  }, []);

  const login = (newToken: string, newUser?: User) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    if (newUser) {
      localStorage.setItem('user', JSON.stringify(newUser));
      setUser(newUser);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
  };

  const updateUser = (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, updateUser, isAuthenticated: !!token, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
