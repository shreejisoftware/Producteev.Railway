import { useCallback } from 'react';
import { Notification } from '../types/notification.types';
import { useAppSelector, useAppDispatch } from '../store';
import {
  fetchNotifications,
  addNotification,
  syncReadStatus,
  markAsReadAction,
  markTaskAsReadAction,
  markAllAsReadAction,
  markInboxSeen,
  markTaskSeenLocal,
  markAllSeenLocal,
} from '../store/slices/notificationSlice';
import { playNotificationSound, speakText } from '../utils/notificationSound';


const extractTaskId = (link: string | null | undefined) => {
  if (!link) return null;
  const match = link.match(/\/(?:tasks|inbox\/task)\/([^/?#]+)/);
  return match ? match[1] : null;
};

export function useNotifications() {
  const dispatch = useAppDispatch();
  const { notifications, unreadCount, badgeCount, loading } = useAppSelector((state) => state.notification);
  const currentOrg = useAppSelector(state => state.organization.currentOrg);

  const loadData = useCallback(async (orgId?: string) => {
    dispatch(fetchNotifications(orgId));
  }, [dispatch]);

  const markAsRead = useCallback(async (id: string) => {
    if (String(id || '').startsWith('slack:')) {
      dispatch(syncReadStatus({ id }));
      return;
    }
    dispatch(markAsReadAction(id));
  }, [dispatch]);

  const resetUnreadCount = useCallback(() => {
    dispatch(markInboxSeen());
  }, [dispatch]);

  const markTaskSeen = useCallback((taskId: string) => {
    if (!taskId) return;
    dispatch(markTaskSeenLocal({ taskId }));
  }, [dispatch]);

  const markAllSeen = useCallback(() => {
    dispatch(markAllSeenLocal());
  }, [dispatch]);

  const markAllAsRead = useCallback(async () => {
    dispatch(markAllAsReadAction(currentOrg?.id));
  }, [dispatch, currentOrg?.id]);

  const markTaskAsRead = useCallback(async (target: Notification | string) => {
    if (!target) return;
    const taskId = typeof target === 'string' ? target : extractTaskId(target.link);
    if (taskId) {
      dispatch(markTaskAsReadAction(taskId));
    } else if (typeof target !== 'string') {
      dispatch(markAsReadAction(target.id));
    }
  }, [dispatch]);

  return {
    notifications,
    unreadCount,
    badgeCount,
    loading,
    markAsRead,
    markAllAsRead,
    markTaskAsRead,
    resetUnreadCount,
    markTaskSeen,
    markAllSeen,
    refresh: loadData
  };
}
