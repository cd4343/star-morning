import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';

// 懒加载组件 - 减少首屏 JS 体积
const Register = lazy(() => import('./pages/auth/Register'));
const Login = lazy(() => import('./pages/auth/Login'));
const CreateFamily = lazy(() => import('./pages/auth/CreateFamily'));
const SelectUser = lazy(() => import('./pages/auth/SelectUser'));
const ParentDashboard = lazy(() => import('./pages/parent/ParentDashboard'));
const ParentTasks = lazy(() => import('./pages/parent/ParentTasks'));
const ParentWishes = lazy(() => import('./pages/parent/ParentWishes'));
const ParentPrivileges = lazy(() => import('./pages/parent/ParentPrivileges'));
const ParentFamily = lazy(() => import('./pages/parent/ParentFamily'));
const ParentAchievements = lazy(() => import('./pages/parent/ParentAchievements'));
const ChildLayout = lazy(() => import('./pages/child/ChildLayout'));
const ChildTasks = lazy(() => import('./pages/child/ChildTasks'));
const ChildWishes = lazy(() => import('./pages/child/ChildWishes'));
const ChildMe = lazy(() => import('./pages/child/ChildMe'));

// 页面加载占位符
const PageLoader = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
    <div className="text-center">
      <div className="text-5xl mb-4 animate-bounce">🌟</div>
      <div className="text-gray-500 text-sm">页面加载中...</div>
    </div>
  </div>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};

const PublicOnlyRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/select-user" replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};

// 智能入口：根据是否有保存的手机号决定跳转
const SmartEntry = () => {
  const { isAuthenticated } = useAuth();
  const lastPhone = localStorage.getItem('last_phone');
  
  if (isAuthenticated) return <Navigate to="/select-user" replace />;
  // 如果有保存的手机号，跳转到登录页；否则跳转到注册页
  return <Navigate to={lastPhone ? "/login" : "/register"} replace />;
};

function App() {
  // 挂载后隐藏 HTML 骨架屏
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).hideInitialLoader) {
      (window as any).hideInitialLoader();
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SmartEntry />} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/create-family" element={<ProtectedRoute><CreateFamily /></ProtectedRoute>} />
        <Route path="/select-user" element={<ProtectedRoute><SelectUser /></ProtectedRoute>} />

        {/* Parent Routes */}
        <Route path="/parent/dashboard" element={<ProtectedRoute><ParentDashboard /></ProtectedRoute>} />
        <Route path="/parent/tasks" element={<ProtectedRoute><ParentTasks /></ProtectedRoute>} />
        <Route path="/parent/wishes" element={<ProtectedRoute><ParentWishes /></ProtectedRoute>} />
        <Route path="/parent/privileges" element={<ProtectedRoute><ParentPrivileges /></ProtectedRoute>} />
        <Route path="/parent/family" element={<ProtectedRoute><ParentFamily /></ProtectedRoute>} />
        <Route path="/parent/achievements" element={<ProtectedRoute><ParentAchievements /></ProtectedRoute>} />

        {/* Child Routes */}
        <Route path="/child" element={<ProtectedRoute><ChildLayout /></ProtectedRoute>}>
          <Route path="tasks" element={<Suspense fallback={<PageLoader />}><ChildTasks /></Suspense>} />
          <Route path="wishes" element={<Suspense fallback={<PageLoader />}><ChildWishes /></Suspense>} />
          <Route path="me" element={<Suspense fallback={<PageLoader />}><ChildMe /></Suspense>} />
          <Route index element={<Navigate to="tasks" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
