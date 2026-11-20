import type { AnchorHTMLAttributes, MouseEvent } from 'react';
import { navigate } from '../router';

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & {
  to: string;
};

/**
 * Ссылка внутри приложения: переходит без перезагрузки страницы, но щелчок с Ctrl/⌘/Shift
 * или средней кнопкой по-прежнему открывает новую вкладку, как у обычной ссылки.
 */
export function Link({ to, ...props }: LinkProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a {...props} href={to} onClick={onClick} />;
}
