import { AuthGate } from './auth/AuthGate';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { JoinPage } from './pages/JoinPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { parseRoute, useLocation } from './router';

export function App() {
  return (
    <AuthGate>
      <Pages />
    </AuthGate>
  );
}

function Pages() {
  const route = parseRoute(useLocation());
  switch (route.page) {
    case 'boards':
      return <BoardsPage view={route} />;
    case 'board':
      return <BoardPage key={route.boardId} boardId={route.boardId} threadId={route.threadId} />;
    case 'join':
      return <JoinPage key={route.token} token={route.token} />;
    case 'account':
      return <AccountPage />;
    case 'admin':
      return <AdminPage />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
