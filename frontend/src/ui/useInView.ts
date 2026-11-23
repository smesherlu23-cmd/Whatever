import { type RefObject, useEffect, useState } from 'react';

/**
 * Показался ли элемент на экране или рядом с ним, в пределах margin. Однажды показавшись,
 * остаётся true: так то, что долго загружать, загружается, только когда до него долистали.
 */
export function useInView(ref: RefObject<Element | null>, margin = '200px'): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (seen || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      { rootMargin: margin },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, margin, seen]);
  return seen;
}
