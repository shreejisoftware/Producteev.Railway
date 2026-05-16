import { createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';
import api from '../../services/api';
import { batchRequests } from '../../services/requestManager';
import { Notification } from '../../types/notification.types';

const TASK_SEEN_KEY = 'inbox_task_last_seen';
const MISC_SEEN_KEY = 'inbox_misc_last_seen';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  badgeCount: number;
  loading: boolean;
  error: string | null;
}

const initialState: NotificationState = {
  notifications: [],
  unreadCount: 0,
  badgeCount: 0,
  loading: false,
  error: null,
};

// --- Thunks ---

export const fetchNotifications = createAsyncThunk(
  'notifications/fetchAll',
  async (orgId?: string) => {
    const params = orgId ? `?orgId=${orgId}` : '';
    const [countRes, notifsRes] = await batchRequests([
      () => api.get<{ success: boolean; data: { count: number } }>(`/notifications/unread-count${params}`),
      () => api.get<{ success: boolean; data: Notification[] }>(`/notifications${params}`),
    ]);
    return {
      unreadCount: countRes.data.data.count,
      notifications: notifsRes.data.data,
    };
  }
);

export const markAsReadAction = createAsyncThunk(
  'notifications/markRead',
  async (id: string) => {
    await api.patch(`/notifications/${id}/read`);
    return id;
  }
);

const extractTaskId = (link: string | null | undefined) => {
  if (!link) return null;
  // Match both /tasks/uuid and /inbox/task/uuid
  const match = link.match(/\/(?:tasks|inbox\/task)\/([^/?#]+)/);
  return match ? match[1] : null;
};

const safeParseJson = <T,>(val: string | null, fallback: T): T => {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
};

const getTaskSeenMap = (): Record<string, number> =>
  safeParseJson<Record<string, number>>(localStorage.getItem(TASK_SEEN_KEY), {});

const setTaskSeen = (taskId: string, ts: number) => {
  const map = getTaskSeenMap();
  map[taskId] = ts;
  localStorage.setItem(TASK_SEEN_KEY, JSON.stringify(map));
};

const getMiscSeen = () => parseInt(localStorage.getItem(MISC_SEEN_KEY) || '0', 10) || 0;
const setMiscSeen = (ts: number) => localStorage.setItem(MISC_SEEN_KEY, ts.toString());

const isNotifNewForBadge = (n: Notification) => {
  if (n.isRead) return false;
  const created = new Date(n.createdAt).getTime();
  const tId = extractTaskId(n.link);
  if (tId) {
    const seen = getTaskSeenMap()[tId] || 0;
    return created > seen;
  }
  return created > getMiscSeen();
};

const calcBadgeCount = (notifications: Notification[]) =>
  notifications.filter(isNotifNewForBadge).length;

const markAllSeenInStorage = (notifications: Notification[]) => {
  const now = Date.now();
  // Mark misc seen
  setMiscSeen(now);
  // Mark each taskId seen
  const map = getTaskSeenMap();
  for (const n of notifications) {
    const tId = extractTaskId(n.link);
    if (tId) map[tId] = now;
  }
  localStorage.setItem(TASK_SEEN_KEY, JSON.stringify(map));
};

const isSlackLocalNotif = (n: Notification) => String(n?.id || '').startsWith('slack:');

const mergeNotifsKeepingSlackLocal = (local: Notification[], remote: Notification[]) => {
  const slackLocal = (local || []).filter(isSlackLocalNotif);
  const combined = [...slackLocal, ...(remote || [])];
  const seen = new Set<string>();
  const deduped: Notification[] = [];
  for (const n of combined) {
    const id = String(n?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push(n);
  }
  // Sort newest-first
  return deduped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const markTaskAsReadAction = createAsyncThunk(
  'notifications/markTaskRead',
  async (taskId: string) => {
    await api.patch(`/notifications/task/${taskId}/read`);
    return taskId;
  }
);

export const markAllAsReadAction = createAsyncThunk(
  'notifications/markAllRead',
  async (orgId?: string) => {
    const params = orgId ? `?orgId=${orgId}` : '';
    await api.patch(`/notifications/mark-all-read${params}`);
    return;
  }
);

const notificationSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addNotification: (state, action: PayloadAction<Notification>) => {
      // Deduplication check: ignore if notification already exists
      const exists = state.notifications.some(n => n.id === action.payload.id);
      if (exists) return;

      state.notifications.unshift(action.payload);
      if (!action.payload.isRead) {
        state.unreadCount += 1;
        if (isNotifNewForBadge(action.payload)) {
          state.badgeCount += 1;
        }
      }
    },
    syncReadStatus: (state, action: PayloadAction<{ id: string }>) => {
      const notif = state.notifications.find(n => n.id === action.payload.id);
      if (notif && !notif.isRead) {
        const wasNewForBadge = isNotifNewForBadge(notif);
        notif.isRead = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
        if (wasNewForBadge) {
          state.badgeCount = Math.max(0, state.badgeCount - 1);
        }
      }
    },
    setNotifications: (state, action: PayloadAction<Notification[]>) => {
      state.notifications = action.payload;
    },
    setUnreadCount: (state, action: PayloadAction<number>) => {
      state.unreadCount = Math.max(0, Number(action.payload) || 0);
    },
    markInboxSeen: (state) => {
      // Mark non-task ("misc") notifications as seen for the badge, without marking them read.
      setMiscSeen(Date.now());
      state.badgeCount = calcBadgeCount(state.notifications);
    },
    markTaskSeenLocal: (state, action: PayloadAction<{ taskId: string }>) => {
      setTaskSeen(action.payload.taskId, Date.now());
      state.badgeCount = calcBadgeCount(state.notifications);
    },
    markAllSeenLocal: (state) => {
      markAllSeenInStorage(state.notifications);
      state.badgeCount = calcBadgeCount(state.notifications);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchNotifications.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchNotifications.fulfilled, (state, action) => {
        state.loading = false;
        const merged = mergeNotifsKeepingSlackLocal(state.notifications, action.payload.notifications);
        const slackUnread = merged.filter((n) => isSlackLocalNotif(n) && !n.isRead).length;
        state.notifications = merged;
        state.unreadCount = Math.max(0, Number(action.payload.unreadCount || 0) + slackUnread);
        state.badgeCount = calcBadgeCount(merged);
      })
      .addCase(fetchNotifications.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch notifications';
      })
      .addCase(markAsReadAction.fulfilled, (state, action) => {
        const notif = state.notifications.find(n => n.id === action.payload);
        if (notif && !notif.isRead) {
          const wasNewForBadge = isNotifNewForBadge(notif);
          notif.isRead = true;
          state.unreadCount = Math.max(0, state.unreadCount - 1);
          if (wasNewForBadge) {
            state.badgeCount = Math.max(0, state.badgeCount - 1);
          }
        }
      })
      .addCase(markAllAsReadAction.fulfilled, (state) => {
        state.notifications.forEach(n => n.isRead = true);
        state.unreadCount = 0;
        state.badgeCount = 0;
      })
      .addCase(markTaskAsReadAction.fulfilled, (state, action) => {
        const taskId = action.payload;
        let countReduced = 0;

        state.notifications = state.notifications.map(n => {
          // Check if notification is related to this task
          const notifTaskId = extractTaskId(n.link);
          const isMatch = notifTaskId === taskId;

          if (isMatch && !n.isRead) {
            countReduced++;
            return { ...n, isRead: true };
          }
          return n;
        });

        // Only reduce the count if the unreadCount actually included these newer notifications
        state.unreadCount = Math.max(0, state.unreadCount - countReduced);

        state.badgeCount = calcBadgeCount(state.notifications);
      });
  },
});

export const { addNotification, syncReadStatus, setNotifications, setUnreadCount, markInboxSeen, markTaskSeenLocal, markAllSeenLocal } = notificationSlice.actions;
export default notificationSlice.reducer;
