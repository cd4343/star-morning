import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [isLoading, setIsLoading] = useState(true); // 初始化时验证 token

  useEffect(() => {
    // 初始化时验证 token 是否有效
    const validateToken = async () => {
      const storedToken = localStorage.getItem('token');
      const storedUser = localStorage.getItem('user');
      
      if (!storedToken) {
        setIsLoading(false);
        return;
      }
      
      try {
        // 尝试调用一个需要认证的 API 来验证 token
        await api.get('/auth/members');
        // Token 有效，恢复用户
        if (storedUser) {
          setUser(JSON.parse(storedUser));
        }
      } catch (err: any) {
        // Token 无效，清除本地存储
        console.log('Token invalid, clearing storage');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };
    
    validateToken();
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

  // 加载中时显示空白，避免闪烁
  if (isLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-bounce">🌟</div>
          <div className="text-gray-500">加载中...</div>
        </div>
      </div>
    );
  }

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

