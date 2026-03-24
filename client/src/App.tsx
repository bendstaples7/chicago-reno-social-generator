import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ErrorToastProvider } from './ErrorToast';
import ProtectedRoute from './ProtectedRoute';
import Layout from './Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MediaLibraryPage from './pages/MediaLibraryPage';
import CreatePostPage from './pages/CreatePostPage';
import PostDetailPage from './pages/PostDetailPage';
import QuickPostPage from './pages/QuickPostPage';
import SettingsPage from './pages/SettingsPage';
import ActivityLogPage from './pages/ActivityLogPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ErrorToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/posts/new" element={<CreatePostPage />} />
                <Route path="/posts/quick" element={<QuickPostPage />} />
                <Route path="/posts/:id" element={<PostDetailPage />} />
                <Route path="/media" element={<MediaLibraryPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/activity-log" element={<ActivityLogPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </ErrorToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
