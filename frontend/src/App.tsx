import { BoardPage } from './pages/BoardPage';
import { BoardsPage } from './pages/BoardsPage';
import { boardIdFromPath, usePath } from './router';

export function App() {
  const boardId = boardIdFromPath(usePath());
  return boardId ? <BoardPage key={boardId} boardId={boardId} /> : <BoardsPage />;
}
