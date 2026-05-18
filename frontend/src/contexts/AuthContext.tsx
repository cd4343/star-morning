import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
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

const readStoredUser = (): User | null => {
  try {
    const storedUser = localStorage.getItem('user');
    return storedUser ? JSON.parse(storedUser) : null;
  } catch {
    localStorage.removeItem('user');
    return null;
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<User | null>(readStoredUser);
  const [isLoading, setIsLoading] = useState(() => Boolean(localStorage.getItem('token')));
  const validationDone = useRef(false);

  useEffect(() => {
    const handleLogoutEvent = () => {
      setToken(null);
      setUser(null);
      setIsLoading(false);
    };

    window.addEventListener('auth:logout', handleLogoutEvent);

    if (!validationDone.current) {
      validationDone.current = true;

      const validateTokenInBackground = async () => {
        const storedToken = localStorage.getItem('token');
        if (!storedToken) {
          setIsLoading(false);
          return;
        }

        try {
          const timeoutPromise = new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error('timeout')), 8000);
          });

          await Promise.race([
            api.get('/auth/members'),
            timeoutPromise,
          ]);
        } catch (err: any) {
          if (err.response?.status === 401 || err.response?.status === 403) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setToken(null);
            setUser(null);
          }
        } finally {
          setIsLoading(false);
        }
      };

      validateTokenInBackground();
    }

    return () => {
      window.removeEventListener('auth:logout', handleLogoutEvent);
    };
  }, []);

  const login = (newToken: string, newUser?: User) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    setIsLoading(false);

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
    setIsLoading(false);
  };

  const updateUser = (updates: Partial<User>) => {
    if (!user) return;
    const updated = { ...user, ...updates };
    setUser(updated);
    localStorage.setItem('user', JSON.stringify(updated));
  };

  return (
    <AuthContext.Provider value={{
      user,
      token,
      login,
      logout,
      updateUser,
      isAuthenticated: Boolean(token),
      isLoading,
    }}>
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
