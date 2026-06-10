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
const ParentLearning = lazy(() => import('./pages/parent/ParentLearning'));
const ParentWellbeing = lazy(() => import('./pages/parent/ParentWellbeing'));
const ParentMorning = lazy(() => import('./pages/parent/ParentMorning'));
const ParentRulesInsights = lazy(() => import('./pages/parent/ParentRulesInsights'));
const ParentWishes = lazy(() => import('./pages/parent/ParentWishes'));
const ParentPrivileges = lazy(() => import('./pages/parent/ParentPrivileges'));
const ParentFamily = lazy(() => import('./pages/parent/ParentFamily'));
const ParentAchievements = lazy(() => import('./pages/parent/ParentAchievements'));
const ParentPunishment = lazy(() => import('./pages/parent/ParentPunishment'));
const ParentExplore = lazy(() => import('./pages/parent/ParentExplore'));
const ChildLayout = lazy(() => import('./pages/child/ChildLayout'));
const ChildChallenge = lazy(() => import('./pages/child/ChildChallenge'));
const ChildCalm = lazy(() => import('./pages/child/ChildCalm'));
const ChildMorning = lazy(() => import('./pages/child/ChildMorning'));
const ChildWishes = lazy(() => import('./pages/child/ChildWishes'));
const ChildMe = lazy(() => import('./pages/child/ChildMe'));
const ChildExplore = lazy(() => import('./pages/child/ChildExplore'));

// 页面加载占位符
const PageLoader = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
    <div className="text-center">
      <div className="text-5xl mb-4 animate-bounce">🌟</div>
      <div className="text-gray-500 text-sm">页面加载中...</div>
    </div>
  </div>
);

// 404 页面
const NotFound = () => (
  <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
    <div className="text-center p-8">
      <div className="text-8xl mb-6">🔍</div>
      <h1 className="text-2xl font-bold text-gray-800 mb-2">页面不存在</h1>
      <p className="text-gray-500 mb-6">您访问的页面可能已被移除或地址有误</p>
      <a 
        href="/" 
        className="inline-block px-6 py-3 bg-blue-500 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-600 transition-colors"
      >
        返回首页
      </a>
    </div>
  </div>
);

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};

const RoleRoute = ({ role, children }: { role: 'parent' | 'child'; children: React.ReactNode }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/select-user" replace />;
  if (user?.role !== role) return <Navigate to={user?.role === 'parent' ? '/parent/dashboard' : '/child/challenge'} replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};

const PublicOnlyRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <PageLoader />;
  if (isAuthenticated) return <Navigate to="/select-user" replace />;
  return <Suspense fallback={<PageLoader />}>{children}</Suspense>;
};

// 智能入口：根据是否有保存的手机号决定跳转
const SmartEntry = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const lastPhone = localStorage.getItem('last_phone');
  
  if (isLoading) return <PageLoader />;
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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<SmartEntry />} />
        <Route path="/register" element={<PublicOnlyRoute><Register /></PublicOnlyRoute>} />
        <Route path="/login" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />
        <Route path="/create-family" element={<ProtectedRoute><CreateFamily /></ProtectedRoute>} />
        <Route path="/select-user" element={<ProtectedRoute><SelectUser /></ProtectedRoute>} />

        {/* Parent Routes */}
        <Route path="/parent/dashboard" element={<RoleRoute role="parent"><ParentDashboard /></RoleRoute>} />
        <Route path="/parent/tasks" element={<RoleRoute role="parent"><ParentTasks /></RoleRoute>} />
        <Route path="/parent/learning" element={<RoleRoute role="parent"><ParentLearning /></RoleRoute>} />
        <Route path="/parent/wellbeing" element={<RoleRoute role="parent"><ParentWellbeing /></RoleRoute>} />
        <Route path="/parent/morning" element={<RoleRoute role="parent"><ParentMorning /></RoleRoute>} />
        <Route path="/parent/rules-insights" element={<RoleRoute role="parent"><ParentRulesInsights /></RoleRoute>} />
        <Route path="/parent/wishes" element={<RoleRoute role="parent"><ParentWishes /></RoleRoute>} />
        <Route path="/parent/privileges" element={<RoleRoute role="parent"><ParentPrivileges /></RoleRoute>} />
        <Route path="/parent/family" element={<RoleRoute role="parent"><ParentFamily /></RoleRoute>} />
        <Route path="/parent/achievements" element={<RoleRoute role="parent"><ParentAchievements /></RoleRoute>} />
        <Route path="/parent/punishment" element={<RoleRoute role="parent"><ParentPunishment /></RoleRoute>} />
        <Route path="/parent/explore" element={<RoleRoute role="parent"><ParentExplore /></RoleRoute>} />

        {/* Child Routes */}
        <Route path="/child" element={<RoleRoute role="child"><ChildLayout /></RoleRoute>}>
          <Route path="map" element={<Navigate to="challenge" replace />} />
          <Route path="challenge" element={<Suspense fallback={<PageLoader />}><ChildChallenge /></Suspense>} />
          <Route path="tasks" element={<Navigate to="/child/challenge" replace />} />
          <Route path="learning" element={<Navigate to="/child/challenge" replace />} />
          <Route path="calm" element={<Suspense fallback={<PageLoader />}><ChildCalm /></Suspense>} />
          <Route path="morning" element={<Suspense fallback={<PageLoader />}><ChildMorning /></Suspense>} />
          <Route path="explore" element={<Suspense fallback={<PageLoader />}><ChildExplore /></Suspense>} />
          <Route path="wishes" element={<Suspense fallback={<PageLoader />}><ChildWishes /></Suspense>} />
          <Route path="me" element={<Suspense fallback={<PageLoader />}><ChildMe /></Suspense>} />
          <Route index element={<Navigate to="challenge" replace />} />
        </Route>
        
        {/* 404 页面 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
