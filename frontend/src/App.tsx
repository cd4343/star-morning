// ... imports
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Register from './pages/auth/Register';
import Login from './pages/auth/Login';
import CreateFamily from './pages/auth/CreateFamily';
import SelectUser from './pages/auth/SelectUser';
import ParentDashboard from './pages/parent/ParentDashboard';
import ParentTasks from './pages/parent/ParentTasks';
import ParentWishes from './pages/parent/ParentWishes';
import ParentPrivileges from './pages/parent/ParentPrivileges';
import ParentFamily from './pages/parent/ParentFamily';
import ParentAchievements from './pages/parent/ParentAchievements'; // NEW
import ChildLayout from './pages/child/ChildLayout';
import ChildTasks from './pages/child/ChildTasks';
import ChildWishes from './pages/child/ChildWishes';
import ChildMe from './pages/child/ChildMe';
import { useAuth } from './contexts/AuthContext';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const PublicOnlyRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  if (isAuthenticated) return <Navigate to="/select-user" replace />;
  return <>{children}</>;
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
  const { isAuthenticated } = useAuth();

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
        <Route path="/parent/achievements" element={<ProtectedRoute><ParentAchievements /></ProtectedRoute>} /> {/* NEW */}

        {/* Child Routes */}
        <Route path="/child" element={<ProtectedRoute><ChildLayout /></ProtectedRoute>}>
          <Route path="tasks" element={<ChildTasks />} />
          <Route path="wishes" element={<ChildWishes />} />
          <Route path="me" element={<ChildMe />} />
          <Route index element={<Navigate to="tasks" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
