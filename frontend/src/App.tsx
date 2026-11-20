import { AuthGate } from './auth/AuthGate';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { parseRoute, usePath } from './router';

export function App() {
  return (
    <AuthGate>
      <Pages />
    </AuthGate>
  );
}

function Pages() {
  const route = parseRoute(usePath());
  switch (route.page) {
    case 'boards':
      return <BoardsPage />;
    case 'board':
      return <BoardPage key={route.boardId} boardId={route.boardId} />;
    case 'account':
      return <AccountPage />;
    case 'admin':
      return <AdminPage />;
    case 'not-found':
      return <NotFoundPage />;
  }
}
