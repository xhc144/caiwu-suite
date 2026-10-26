import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { NotifyBridge, queryClient, useBootstrap, useSession } from '@caiwu/web-kit';
import { EntryPage } from './shell/EntryPage';
import { Shell } from './shell/Shell';
import { BookPickerPage } from './pages/BookPickerPage';
import { LoginPage } from './pages/LoginPage';
import { theme } from './theme';

export function App() {
  return (
    <ConfigProvider locale={zhCN} theme={theme} button={{ autoInsertSpace: false }}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <NotifyBridge />
            <AppRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

function AppRoutes() {
  const session = useSession();
  const boot = useBootstrap();
  const devMode = boot?.devMode ?? false;
  return (
    <Routes>
      <Route
        path="/"
        element={<EntryPage kind="bookPicker" devMode={devMode} fallback={<BookPickerPage />} />}
      />
      <Route path="/login/:bookId" element={<LoginRoute devMode={devMode} />} />
      <Route
        path="/*"
        element={session ? <Shell devMode={devMode} /> : <Navigate to="/" replace />}
      />
    </Routes>
  );
}

function LoginRoute({ devMode }: { devMode: boolean }) {
  const { bookId = '' } = useParams();
  return (
    <EntryPage
      kind="login"
      devMode={devMode}
      props={{ bookId }}
      fallback={<LoginPage bookId={bookId} />}
    />
  );
}
