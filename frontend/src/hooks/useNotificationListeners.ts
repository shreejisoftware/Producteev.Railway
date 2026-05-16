import { useEffect, useRef } from 'react';
import { useSocket } from './useSocket';
import { Notification } from '../types/notification.types';
import { useAppSelector, useAppDispatch } from '../store';
import {
  fetchNotifications,
  addNotification,
  syncReadStatus,
  markAllAsReadAction,
} from '../store/slices/notificationSlice';
import { playNotificationSound, speakText } from '../utils/notificationSound';

import { useToast } from '../components/ui/Toast';

/**
 * SINGLETON HOOK: Should ONLY be called once in MainLayout.
 * Handles socket listeners and audio alerts.
 */
export function useNotificationListeners() {
  const dispatch = useAppDispatch();
  const socket = useSocket();
  const toast = useToast();
  const currentOrg = useAppSelector(state => state.organization.currentOrg);
  const currentUser = useAppSelector(state => state.user.currentUser);
  const token = useAppSelector(state => state.auth.accessToken);
  const taskReadDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadData = (orgId?: string) => {
    dispatch(fetchNotifications(orgId));
  };

  useEffect(() => {
    if (!token) return;
    loadData(currentOrg?.id);
    
    // Proactively request permission on mount
    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
      window.Notification.requestPermission();
    }
  }, [currentOrg?.id, token]);

  useEffect(() => {
    if (!socket || !token) return;

    const handleNewNotification = (newNotif: Notification) => {
      dispatch(addNotification(newNotif));
      
      // Show a richer in-app toast for live notifications
      toast.notification(newNotif.message || '', {
        sender: newNotif.senderAvatarUrl
          ? { name: 'Producteev', avatar: newNotif.senderAvatarUrl }
          : undefined,
        websiteIcon: '/shreeji-logo.svg',
        websiteName: 'Producteev',
        title: newNotif.title || 'New Notification',
        duration: 5000,
      });

      const userSettings = (currentUser?.settings as any)?.notifications || {};
      const shouldPlaySound = userSettings.playNotificationSound !== false; 
      const shouldSpeak = userSettings.speakSenderName === true;
      const voiceName = userSettings.selectedVoice;
      let soundKey = userSettings.selectedSound || 'default';

      if (newNotif.senderId && userSettings.perUserSounds?.[newNotif.senderId]) {
        soundKey = userSettings.perUserSounds[newNotif.senderId];
      }

      if (shouldPlaySound) {
        playNotificationSound(soundKey);
      }

      if (shouldSpeak) {
        const senderName = newNotif.title.split(' ')[0] || 'Someone';
        const messageSnippet = newNotif.message ? `. ${newNotif.message.slice(0, 100)}` : '';
        speakText(`Notification from ${senderName}${messageSnippet}`, voiceName);
      }

      const lastNotifTime = parseInt(localStorage.getItem('last_notif_time') || '0');
      const now = Date.now();
      if (now - lastNotifTime > 1000) {
        localStorage.setItem('last_notif_time', now.toString());
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (window.Notification.permission === 'granted') {
            const getAbsoluteUrl = (url: string) => {
              if (!url) return undefined;
              if (url.startsWith('http')) return url;
              return window.location.origin + url;
            };

            const cleanTitle = (newNotif.title && isNaN(Number(newNotif.title))) ? newNotif.title : 'Producteev Notification';

            new window.Notification(cleanTitle, {
              body: newNotif.message || 'New activity in Producteev',
              icon: getAbsoluteUrl(newNotif.senderAvatarUrl || '') || getAbsoluteUrl('/tab-icon.png'),
              badge: getAbsoluteUrl('/tab-icon.png'),
              tag: newNotif.id,
            });
          }
        }
      }
    };

    const handleReadSync = (data: { id: string }) => dispatch(syncReadStatus(data));
    const handleReadAllSync = () => dispatch(markAllAsReadAction());
    const handleTaskReadSync = () => {
      if (taskReadDebounceRef.current) clearTimeout(taskReadDebounceRef.current);
      taskReadDebounceRef.current = setTimeout(() => {
        dispatch(fetchNotifications(currentOrg?.id));
      }, 500);
    };
    const handleMessagesRead = () => {
      if (taskReadDebounceRef.current) clearTimeout(taskReadDebounceRef.current);
      taskReadDebounceRef.current = setTimeout(() => {
        loadData(currentOrg?.id);
      }, 500);
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:read_sync', handleReadSync);
    socket.on('notification:read_all_sync', handleReadAllSync);
    socket.on('notification:task_read_sync', handleTaskReadSync);
    socket.on('messages:read-receipt', handleMessagesRead);

    // Ensure we are in our own room to receive private notifications
    socket.emit('join-own-room');

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:read_sync', handleReadSync);
      socket.off('notification:read_all_sync', handleReadAllSync);
      socket.off('notification:task_read_sync', handleTaskReadSync);
      socket.off('messages:read-receipt', handleMessagesRead);
    };
  }, [socket, token, currentOrg?.id, currentUser, dispatch]);
}
