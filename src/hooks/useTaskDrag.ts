import { useCallback, useRef } from 'react';
import { Draggable } from '@fullcalendar/interaction';

/** The callback ref follows the actual panel node, including unmount/remount and StrictMode. */
export function useTaskDrag(defaultDurationMinutes: number) {
  const duration = useRef(defaultDurationMinutes);
  duration.current = defaultDurationMinutes;
  const active = useRef<{ node: HTMLDivElement; draggable: Draggable } | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (active.current?.node === node) return;
    active.current?.draggable.destroy();
    active.current = null;
    if (!node) return;
    const draggable = new Draggable(node, {
      itemSelector: '.drag-handle[data-task-id]',
      longPressDelay: 350,
      minDistance: 5,
      appendTo: document.body,
      eventData: (element) => ({
        title: element.dataset.taskTitle ?? '任务安排',
        duration: { minutes: duration.current },
        create: false,
        extendedProps: { taskId: element.dataset.taskId },
      }),
    });
    active.current = { node, draggable };
  }, []);
  return attach;
}
