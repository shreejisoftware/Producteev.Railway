import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NavLink, Link, useLocation, useNavigate, Outlet } from 'react-router';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { useAppSelector, useAppDispatch, store } from '../../store';
import api from '../../services/api';
import { useOrgRole } from '../../hooks/useOrgRole';
import { setCurrentOrg, setOrganizations } from '../../store/slices/organizationSlice';
import { SearchTrigger, SearchModal } from './SearchBar';
import { setOnlineUsers as setGlobalOnlineUsers, setUser } from '../../store/slices/userSlice';
import {
  incrementUnread,
  resetUnread,
  fetchUnreadCounts,
  markAsRead as markAsReadAction,
  setAllUnread
} from '../../store/slices/messageSlice';
import { GlobalTimer } from '../time-tracking/GlobalTimer';
import { NotificationBell } from './NotificationBell';
import { CreateFolderModal } from '../modals/CreateFolderModal';
import { CreateListModal } from '../modals/CreateListModal';
import { DeleteConfirmModal } from '../modals/DeleteConfirmModal';
import { RenameModal } from '../modals/RenameModal';
import { Space, Task } from '../../types';
import { useNotifications } from '../../hooks/useNotifications';
import { useNotificationListeners } from '../../hooks/useNotificationListeners';
import { useSocket } from '../../hooks/useSocket';
import { VideoCallModal } from '../chat/VideoCallModal';
import { CreateSpaceModal } from '../modals/CreateSpaceModal';
import { ScreenRequestPrompt } from '../modals/ScreenRequestPrompt';
import { ScreenShareModal } from '../modals/ScreenShareModal';
import { useFaviconNotification } from '../../hooks/useFaviconNotification';
import { useToast } from '../ui/Toast';
import { openOAuthPopup } from '../../utils/openOAuthPopup';
import { resolveAssetUrl } from '../../utils/assetUrl';
import producteevLogoUrl from './website name.png';
import slackDefaultIconUrl from './Gemini_Generated_Image_58b60358b60358b6-removebg-preview.png';

const PRODUCTEEV_LOGO_URL = producteevLogoUrl;

const DEFAULT_SLACK_ICON_URL = slackDefaultIconUrl;

const SLACK_ICON_URL: string = (import.meta as any)?.env?.VITE_SLACK_ICON_URL || DEFAULT_SLACK_ICON_URL;

const SLACK_CH_EXPANDED_STORAGE = 'producteev:slackSidebarChannelsExpanded';

const getWorkspaceLogo = (org: any) => {
  if (org?.settings?.logoUrl) return resolveAssetUrl(org.settings.logoUrl);
  const name = org?.name || 'Workspace';
  const initial = name.charAt(0).toUpperCase();
  return `https://ui-avatars.com/api/?name=${initial}&background=6366f1&color=fff&bold=true&rounded=true`;
};

const WorkspaceDropdownPanel = React.memo(({ coords, onClose }: {
  coords: { top: number; left: number };
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const currentOrg = useAppSelector(state => state.organization.currentOrg);
  const organizations = useAppSelector(state => state.organization.organizations);
  const dispatch = useAppDispatch();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { isAdmin: currentIsAdmin, isOwner, isSuperAdmin, canCreateSpace, canManagePeople } = useOrgRole();

  useEffect(() => {
    if (dropdownRef.current) {
      dropdownRef.current.style.top = `${coords.top}px`;
      dropdownRef.current.style.left = `${coords.left}px`;
    }
  }, [coords]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleSwitch = (org: any) => {
    if (org.id === currentOrg?.id) return;
    // Do not default missing roles to MEMBER; it causes role-gated UI (like Slack identity status)
    // to appear incorrectly for limited/guest/admin accounts if API payload is missing role.
    dispatch(setCurrentOrg({ org, role: org.role || null }));
    onClose();
    window.location.reload(); // Refresh to clear states
  };

  return (
    <div
      ref={dropdownRef}
      className="fixed w-[320px] bg-white dark:bg-[#1E2530] rounded-xl shadow-2xl dark:shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-gray-200 dark:border-[#2D3748] z-[9999] text-sans overflow-hidden animate-scale-in origin-top-left"
    >
      <div className="p-4 pb-2">
        <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">Workspaces</p>
        <div className="space-y-1 mb-4 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
          {organizations
            .filter((org, index, self) =>
              index === self.findIndex((o) => o.id === org.id)
            )
            .map((org) => (
              <div
                key={org.id}
                onClick={() => handleSwitch(org)}
                className={`group w-full flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-200 ${currentOrg?.id === org.id
                  ? 'bg-indigo-50/80 dark:bg-indigo-500/10 border-2 border-indigo-500/50 shadow-sm'
                  : 'border-2 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-black shadow-md shrink-0 transition-transform group-hover:scale-105 overflow-hidden border-2 ${currentOrg?.id === org.id
                  ? 'border-indigo-200 dark:border-indigo-800'
                  : 'border-transparent'
                  }`}>
                  <img src={getWorkspaceLogo(org)} alt="" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <h3 className={`text-[13px] font-bold truncate tracking-tight ${currentOrg?.id === org.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-800 dark:text-gray-200'}`}>
                    {org.name}
                  </h3>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider opacity-80">{org.role?.toLowerCase() || 'member'}</p>
                </div>

                {(org.role === 'OWNER' || org.role === 'SUPER_ADMIN') && (
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate('/settings?tab=workspace'); onClose(); }}
                      className="p-1.5 bg-white dark:bg-gray-700 rounded-lg text-gray-400 hover:text-indigo-600 transition-all hover:shadow-sm active:scale-90"
                      title="Workspace Settings"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </button>
                  </div>
                )}

                {currentOrg?.id === org.id && (
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
                )}
              </div>
            ))}
        </div>

        <div className="pt-2 mx-2 mb-2 border-t border-gray-100 dark:border-gray-800/50 space-y-0.5">
          <button
            onClick={() => { navigate('/settings'); onClose(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/80 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all group"
          >
            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800/80 flex items-center justify-center group-hover:bg-indigo-50 dark:group-hover:bg-indigo-500/20 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            Settings
          </button>
          {currentOrg?.id && canManagePeople && (
            <button
              onClick={() => { navigate('/people'); onClose(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/80 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all group"
            >
              <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800/50 flex items-center justify-center group-hover:bg-indigo-50 dark:group-hover:bg-indigo-900/20 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              </div>
              Manage People
            </button>
          )}
        </div>
      </div>
      {(isOwner || isSuperAdmin || organizations.length === 0) && (
        <div className="p-3 bg-gray-50/50 dark:bg-gray-900/30 border-t border-gray-100 dark:border-gray-800/50">
          <button
            onClick={() => { navigate('/onboarding/workspace'); onClose(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-black text-indigo-600 dark:text-indigo-400 bg-white dark:bg-gray-800/50 shadow-sm border border-indigo-100 dark:border-indigo-900/30 hover:shadow-md hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            Create Workspace
          </button>
        </div>
      )}
    </div>
  );
});


const TaskTagDot = React.memo(({ color, name }: { color: string; name: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.backgroundColor = `${color}${document.documentElement.classList.contains('dark') ? '30' : '15'}`;
      ref.current.style.color = color;
      ref.current.style.border = `1px solid ${color}40`;
    }
  }, [color]);

  return (
    <div
      ref={ref}
      className="flex items-center px-1.5 py-0 rounded-[4px] text-[9px] font-bold tracking-tight uppercase"
      title={name}
    >
      <span className="truncate max-w-[50px]">{name}</span>
    </div>
  );
});

const SpaceIcon = React.memo(({ color, icon, name, isAdmin, onClick }: { color: string; icon?: string; name: string; isAdmin: boolean; onClick?: (e: React.MouseEvent) => void }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.backgroundColor = color || '#6366f1';
  }, [color]);
  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`w-[26px] h-[26px] rounded-[7px] flex items-center justify-center text-[13px] text-white shrink-0 shadow-sm font-black transition-transform group-hover/btn:scale-110 ${isAdmin ? 'cursor-pointer' : 'cursor-default'}`}
      title={isAdmin ? 'View Space Dashboard' : undefined}
    >
      {icon || name.charAt(0).toUpperCase()}
    </div>
  );
});

export function MainLayout() {
  const toastApi = useToast();
  const { currentUser, logout } = useAuth();
  const { isDark, toggle: toggleThemeMode } = useTheme();
  const { isAdmin, isOwner, isSuperAdmin, isMember, isLimitedMember, isGuest, canCreateSpace, canManagePeople } = useOrgRole();
  useNotificationListeners();

  // Global interaction handler to "unlock" audio for notifications
  useEffect(() => {
    const unlockAudio = () => {
      if (typeof window !== 'undefined') {
        // Resume AudioContext if it exists
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const dummyCtx = new AudioCtx();
          if (dummyCtx.state === 'suspended') dummyCtx.resume();
        }
        // Also speak a silent string to unlock Speech API
        if ('speechSynthesis' in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
        }
      }
      window.removeEventListener('click', unlockAudio);
    };
    window.addEventListener('click', unlockAudio);
    return () => window.removeEventListener('click', unlockAudio);
  }, []);

  const showFullSidebar = !!currentUser;
  // Show Slack entry for all authenticated roles (member/limited/guest/admin).
  // `currentUser` can be temporarily null during boot while auth state is already true.
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const showSlackNav = Boolean(isAuthenticated);
  const showSlackIdentityStatus = !isGuest;
  const dispatch = useAppDispatch();
  const canManageSpaces = isOwner || isSuperAdmin;
  const currentOrg = useAppSelector(state => state.organization.currentOrg);
  const accessToken = useAppSelector(state => state.auth.accessToken);
  const { badgeCount, refresh: refreshNotifications } = useNotifications();
  const slackUnreadCount = useAppSelector((state) =>
    (state.notification?.notifications || []).filter((n: any) => String(n?.id || '').startsWith('slack:') && !n?.isRead).length
  );
  const notifications = useAppSelector((state) => (state.notification?.notifications || []));
  const slackUnreadByChannel = useMemo(() => {
    const out: Record<string, number> = {};
    for (const n of notifications as any[]) {
      const id = String(n?.id || '');
      if (!id.startsWith('slack:')) continue;
      if (n?.isRead) continue;
      const parts = id.split(':');
      // slack:<orgId>:<channelId>:<ts>
      const channelId = parts.length >= 4 ? parts[2] : '';
      if (!channelId) continue;
      out[channelId] = (out[channelId] || 0) + 1;
    }
    return out;
  }, [notifications]);
  const [slackSidebarUnreadByChannel, setSlackSidebarUnreadByChannel] = useState<Record<string, number>>({});
  const slackSidebarLastTsRef = useRef<Record<string, string>>({});
  useFaviconNotification();
  const navigate = useNavigate();
  const location = useLocation();
  const slackSidebarChannelId = useMemo(() => {
    if (location.pathname !== '/slack') return null;
    return new URLSearchParams(location.search).get('channelId');
  }, [location.pathname, location.search]);
  const isSlackSidebarRootActive = location.pathname === '/slack' && !slackSidebarChannelId;
  const handleSidebarLinkClick = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  };
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const socket = useSocket();
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackUserConnected, setSlackUserConnected] = useState(false);
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [slackHoverOpen, setSlackHoverOpen] = useState(false);

  // Poll Slack activity to update per-channel unread badges in sidebar.
  // This is a fallback for channels where Slack realtime events are not delivered.
  useEffect(() => {
    if (!slackConnected || !currentOrg?.id) return;
    let stopped = false;
    const orgId = currentOrg.id;
    const key = `slackSidebarLastTs:${orgId}`;
    try {
      slackSidebarLastTsRef.current = JSON.parse(localStorage.getItem(key) || '{}') || {};
    } catch {
      slackSidebarLastTsRef.current = {};
    }

    const tick = async () => {
      try {
        const res = await api.get<{ success: boolean; data: Array<{ channelId: string; ts: string }> }>(`/slack/activity`, {
          params: { orgId, limit: 80 },
        });
        if (stopped) return;
        if (!res.data?.success) return;
        const items = (res.data.data || []) as any[];
        const nextUnread: Record<string, number> = {};
        for (const it of items) {
          const ch = String(it?.channelId || '');
          const ts = String(it?.ts || '');
          if (!ch || !ts) continue;
          const prevTs = slackSidebarLastTsRef.current[ch];
          if (!prevTs) {
            slackSidebarLastTsRef.current[ch] = ts;
            continue;
          }
          if (Number(ts) > Number(prevTs)) {
            nextUnread[ch] = (nextUnread[ch] || 0) + 1;
            slackSidebarLastTsRef.current[ch] = ts;
          }
        }
        if (Object.keys(nextUnread).length > 0) {
          setSlackSidebarUnreadByChannel((prev) => {
            const merged = { ...prev };
            for (const [ch, n] of Object.entries(nextUnread)) merged[ch] = (merged[ch] || 0) + (n || 0);
            return merged;
          });
          try {
            localStorage.setItem(key, JSON.stringify(slackSidebarLastTsRef.current));
          } catch { }
        }
      } catch {
        // ignore
      }
    };

    const t = window.setInterval(tick, 15_000);
    tick();
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [slackConnected, currentOrg?.id]);

  const connectSlackIdentity = useCallback(async () => {
    if (!currentOrg?.id) return;
    const res = await api.get<{ success: boolean; data: { url: string } }>(`/slack/user/oauth/start`, {
      params: { orgId: currentOrg.id },
    });
    const url = res?.data?.data?.url;
    if (url && !openOAuthPopup(url)) {
      toastApi.error(
        'Popup blocked — the Slack link was copied. Paste it into your main browser (e.g. Chrome) where the correct Slack workspace is signed in.'
      );
    }
  }, [currentOrg?.id, toastApi]);

  const disconnectSlackIdentity = useCallback(async () => {
    if (!currentOrg?.id) return;
    await api.post(`/slack/user/disconnect`, { orgId: currentOrg.id });
    setSlackUserConnected(false);
  }, [currentOrg?.id]);

  const fetchSlackChannels = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const status = await api.get<{ success: boolean; data: { configured: boolean; userConnected?: boolean } }>(`/slack/status`, {
        params: { orgId: currentOrg.id },
      });
      const connected = Boolean(status.data?.data?.configured);
      setSlackConnected(connected);
      if (!connected) {
        setSlackUserConnected(false);
        setSlackChannels([]);
        return;
      }
      setSlackUserConnected(Boolean((status.data?.data as any)?.userConnected));
      const res = await api.get<{ success: boolean; data: Array<{ id: string; name: string }> }>(`/slack/channels`, { params: { orgId: currentOrg.id } });
      if (res.data.success) setSlackChannels(res.data.data || []);
    } catch {
      setSlackConnected(false);
      setSlackUserConnected(false);
    }
  }, [currentOrg?.id]);

  // Auto-close sidebar on route change (mobile)
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }
  }, [location.pathname]);

  const [workspaceDropdownCoords, setWorkspaceDropdownCoords] = useState({ top: 0, left: 0 });
  const workspaceBtnRef = useRef<HTMLDivElement>(null);

  const handleWorkspaceToggle = () => {
    if (workspaceBtnRef.current) {
      const rect = workspaceBtnRef.current.getBoundingClientRect();
      setWorkspaceDropdownCoords({ top: rect.bottom + 8, left: rect.left });
    }
    setWorkspaceDropdownOpen(prev => !prev);
  };

  const userDropdownRef = useRef<HTMLDivElement>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [isSidebarMini, setIsSidebarMini] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const handleUserUpdated = (updatedUser: any) => {
      if (updatedUser?.id === currentUser?.id) {
        dispatch(setUser(updatedUser));
      }
    };
    socket.on('user:updated', handleUserUpdated);
    return () => {
      socket.off('user:updated', handleUserUpdated);
    };
  }, [socket, currentUser?.id, dispatch]);

  // Close user dropdown on outside click
  useEffect(() => {
    if (!userDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userDropdownOpen]);


  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);


  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(200, Math.min(480, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const [isFavoritesOpen, setIsFavoritesOpen] = useState(true);
  const [showAllFavorites, setShowAllFavorites] = useState(false);
  const [isMyTasksExpanded, setIsMyTasksExpanded] = useState(true);
  const [isSlackChannelsExpanded, setIsSlackChannelsExpanded] = useState(() => {
    try {
      const v = localStorage.getItem(SLACK_CH_EXPANDED_STORAGE);
      if (v === '0') return false;
      if (v === '1') return true;
    } catch {
      /* ignore */
    }
    return true;
  });
  const [assignedTasks, setAssignedTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (location.pathname !== '/slack') return;
    if (slackSidebarChannelId) setIsSlackChannelsExpanded(true);
  }, [location.pathname, slackSidebarChannelId]);
  const [incomingCall, setIncomingCall] = useState<{ fromUserId: string; callerName: string } | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [failedAvatars, setFailedAvatars] = useState<Set<string>>(new Set());
  const [screenRequest, setScreenRequest] = useState<{ adminId: string; adminName?: string } | null>(null);
  const [monitoringUser, setMonitoringUser] = useState<{ id: string; name: string; initials: string; color: string } | null>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteSet = useRef<boolean>(false);


  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => {
      console.log('MAIN_LAYOUT: Socket Connected:', socket.id);
      // Re-join rooms after reconnect (backend restarts drop room membership)
      if (currentUser) {
        socket.emit('join-own-room'); // Lock identity room
        socket.emit('admin:join-monitor'); // Join admin monitoring pool
      }
      if (currentOrg?.id) {
        socket.emit('join-organization', currentOrg.id);
      }
    };

    // initial join (in case we are already connected)
    handleConnect();
    socket.on('connect', handleConnect);

    socket.on('video:call:incoming', (data: { fromUserId: string; callerName: string }) => {
      setIncomingCall(data);
    });

    socket.on('admin:screen-request-global', (data: { targetUserId: string; adminId: string; adminName?: string }) => {
      if (currentUser && data.targetUserId === currentUser.id) {
        console.log('MAIN_LAYOUT: GLOBAL MONITOR REQUEST RECEIVED FOR ME!');
        setScreenRequest({ adminId: data.adminId, adminName: data.adminName });
      }
    });

    socket.on('webrtc:answer', async (data: { fromUserId: string; answer: RTCSessionDescriptionInit }) => {
      if (peerConnection.current) {
        try {
          await peerConnection.current.setRemoteDescription(new RTCSessionDescription(data.answer));
          isRemoteSet.current = true;

          while (iceQueue.current.length > 0) {
            const cand = iceQueue.current.shift();
            if (cand) await peerConnection.current.addIceCandidate(new RTCIceCandidate(cand));
          }
        } catch (err) {
          console.error('Failed to set remote description for answer:', err);
        }
      }
    });

    socket.on('admin:ice-candidate', (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
      // Only process if we have an active connection
      if (peerConnection.current && isRemoteSet.current) {
        peerConnection.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => { });
      } else {
        iceQueue.current.push(data.candidate);
      }
    });

    socket.on('webrtc:stop-share', () => {
      if (peerConnection.current) {
        peerConnection.current.close();
        peerConnection.current = null;
      }
      isRemoteSet.current = false;
      iceQueue.current = [];
      if (screenStream.current) {
        screenStream.current.getTracks().forEach(t => t.stop());
        screenStream.current = null;
      }
      setScreenRequest(null);
    });

    socket.on('video:call:accepted', () => {
      // Logic for caller when receiver accepts (could show "Connected")
    });

    socket.on('video:call:rejected', () => {
      // Logic for caller when receiver rejects (could show "Call Ended")
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('video:call:incoming');
      socket.off('video:call:accepted');
      socket.off('video:call:rejected');
      socket.off('admin:screen-request-global');
      socket.off('webrtc:answer');
      socket.off('admin:ice-candidate');
      socket.off('webrtc:stop-share');
    };
  }, [socket, currentUser, currentOrg?.id]);

  const handleAcceptCall = () => {
    if (socket && incomingCall) {
      socket.emit('video:call:accept', { targetUserId: incomingCall.fromUserId });
    }
  };

  const handleDeclineCall = () => {
    if (socket && incomingCall) {
      socket.emit('video:call:reject', { targetUserId: incomingCall.fromUserId });
    }
    setIncomingCall(null);
  };

  const handleDeclineScreen = () => {
    if (socket && screenRequest) {
      socket.emit('webrtc:stop-share', { targetUserId: screenRequest.adminId });
    }
    setScreenRequest(null);
  };

  const handleAcceptScreen = async () => {
    if (!socket || !screenRequest) return;

    try {
      console.log('USER: Requesting screen media...');
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      console.log('USER: Screen media acquired:', stream.id);
      screenStream.current = stream;

      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' }
        ]
      });
      peerConnection.current = pc; // SET IMMEDIATELY TO AVOID RACE CONDITIONS

      pc.onicecandidate = (event) => {
        if (event.candidate && screenRequest) {
          socket.emit('admin:ice-candidate', {
            targetId: `user:${screenRequest.adminId}`,
            candidate: event.candidate
          });
        }
      };

      stream.getTracks().forEach(track => {
        console.log('USER: Adding track to PC:', track.kind);
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log('USER: Sending Screen Offer to Admin User:', screenRequest.adminId);
      socket.emit('admin:screen-answer', {
        adminId: screenRequest.adminId,
        answer: offer
      });

      setScreenRequest(null);

      stream.getVideoTracks()[0].onended = () => {
        socket.emit('webrtc:stop-share', { targetUserId: screenRequest.adminId });
        pc.close();
      };

    } catch (err) {
      console.error('Screen share failed:', err);
      setScreenRequest(null);
    }
  };

  const [spaces, setSpaces] = useState<Space[]>([]);

  // Persistent Sidebar Expansion States
  const [expandedSpaces, setExpandedSpaces] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('expandedSpaces');
    return saved ? JSON.parse(saved) : {};
  });

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('expandedFolders');
    return saved ? JSON.parse(saved) : {};
  });

  // Persistent Workspace Dropdown State (as requested for "img 2")
  const [workspaceDropdownOpen, setWorkspaceDropdownOpen] = useState(() => {
    return localStorage.getItem('isWorkspaceMenuOpen') === 'true';
  });

  // Save expansion states whenever they change
  useEffect(() => {
    localStorage.setItem('expandedSpaces', JSON.stringify(expandedSpaces));
  }, [expandedSpaces]);

  useEffect(() => {
    localStorage.setItem('expandedFolders', JSON.stringify(expandedFolders));
  }, [expandedFolders]);

  // Save dropdown state whenever it changes
  useEffect(() => {
    localStorage.setItem('isWorkspaceMenuOpen', workspaceDropdownOpen.toString());
  }, [workspaceDropdownOpen]);

  const [favoriteTasks, setFavoriteTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const onlineUsersSet = useAppSelector(state => (state as any).user.onlineUsers);
  const onlineUsers = useMemo(() => new Set(onlineUsersSet), [onlineUsersSet]);
  const onlineUsersRef = useRef<string[]>([]);
  useEffect(() => { onlineUsersRef.current = onlineUsersSet || []; }, [onlineUsersSet]);
  const { unreadCounts: unreadMessageCounts } = useAppSelector(state => state.message);

  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isCreateListOpen, setIsCreateListOpen] = useState(false);
  const [isPlusMenuOpen, setIsPlusMenuOpen] = useState<string | null>(null);
  const [isCreateSpaceOpen, setIsCreateSpaceOpen] = useState(false);

  // Close plus menu on outside click
  useEffect(() => {
    if (!isPlusMenuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-plus-menu]')) {
        setIsPlusMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isPlusMenuOpen]);
  const [deleteData, setDeleteData] = useState<{ type: 'Space' | 'Folder' | 'List' | 'Organization'; id: string; title: string } | null>(null);
  const [renameData, setRenameData] = useState<{ type: 'Space' | 'Folder' | 'List' | 'Organization'; id: string; title: string } | null>(null);

  useEffect(() => {
    if (sidebarRef.current) {
      sidebarRef.current.style.width = isSidebarMini ? '68px' : `${sidebarWidth}px`;
      sidebarRef.current.style.flexShrink = '0';
    }
  }, [isSidebarMini, sidebarWidth]);

  const fetchSpaces = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await api.get<{ success: boolean; data: Space[] }>(`/spaces/my?orgId=${currentOrg.id}`);
      if (res.data.success) setSpaces(res.data.data);
    } catch { }
  }, [currentOrg?.id]);

  const fetchFavorites = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await api.get<{ success: boolean; data: Task[] }>(`/tasks/favorites?orgId=${currentOrg.id}`);
      if (res.data.success) setFavoriteTasks(res.data.data);
    } catch { }
  }, [currentOrg?.id]);

  const fetchAssigned = useCallback(async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await api.get<{ success: boolean; data: Task[] }>(`/tasks/my?orgId=${currentOrg.id}`);
      if (res.data.success) setAssignedTasks(res.data.data);
    } catch { }
  }, [currentOrg?.id]);

  const fetchMembers = useCallback(async () => {
    if (!currentUser) return;
    try {
      // Only fetch for current organization by default to save network calls
      // If no currentOrg, we still fetch to show placeholders
      const orgId = currentOrg?.id;
      if (!orgId) {
        setMembers([{ user: currentUser, role: 'OWNER' }]);
        return;
      }

      const res = await api.get<{ success: boolean; data: any[] }>(`/organizations/${orgId}/members`);
      if (res?.data?.success && Array.isArray(res.data.data)) {
        setMembers(res.data.data);
      }
    } catch (err) {
      console.error('Failed to fetch org members:', err);
      // Fallback to self
      setMembers([{ user: currentUser, role: 'OWNER' }]);
    }
  }, [currentUser, currentOrg?.id]);

  // Refresh members list when user avatar changes to keep sidebar DM list in sync
  useEffect(() => {
    if (currentUser?.avatarUrl && currentOrg?.id) {
      fetchMembers();
    }
  }, [currentUser?.avatarUrl, currentOrg?.id, fetchMembers]);

  const handleGlobalAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be under 2MB');
      return;
    }

    try {
      setIsUploadingAvatar(true);
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await api.post<{ success: boolean; data: any }>('/users/me/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.success) {
        dispatch(setUser(res.data.data));
        // Refresh local members list to show updated avatar immediately in DM list
        fetchMembers();
      }
    } catch (err) {
      console.error('Failed to upload avatar:', err);
      alert('Failed to upload avatar');
    } finally {
      setIsUploadingAvatar(false);
      // Reset input
      e.target.value = '';
    }
  };

  const fetchUnreadMessageCounts = useCallback(async () => {
    dispatch(fetchUnreadCounts());
  }, [dispatch]);

  // Real-time RBAC synchronization
  useEffect(() => {
    if (!socket || !currentUser || !currentOrg) return;

    // Join the organization room to receive updates
    socket.emit('join-organization', currentOrg.id);

    const handleOrgUpdate = async (data: { organizationId: string; userId?: string }) => {
      // Refresh member list if necessary
      if (data.organizationId === currentOrg?.id) {
        fetchMembers();
      }

      if (data.userId && data.userId !== currentUser?.id) return;

      try {
        const res = await api.get<{ success: boolean; data: any[] }>('/organizations');
        if (res?.data?.success && Array.isArray(res.data.data)) {
          const orgs = res.data.data;
          const updatedOrg = orgs.find(o => o?.id === currentOrg?.id);

          if (!updatedOrg) {
            navigate('/');
            window.location.reload();
            return;
          }

          if (updatedOrg.role) {
            dispatch(setCurrentOrg({ org: updatedOrg, role: updatedOrg.role }));
          }
        }
      } catch (err) {
        console.error('Failed to sync RBAC update:', err);
      }
    };

    socket.on('org:role_updated', handleOrgUpdate);
    socket.on('org:role_changed', handleOrgUpdate);
    socket.on('org:membership_updated', handleOrgUpdate);
    socket.on('org:member_added', handleOrgUpdate);
    socket.on('org:member_removed', (data) => {
      if (data.organizationId === currentOrg.id) {
        fetchMembers();
        if (data.userId === currentUser.id) {
          navigate('/');
          window.location.reload();
        }
      }
    });

    const handlePeopleUpdate = () => fetchMembers();
    socket.on('people:updated', handlePeopleUpdate);

    // Real-time online signaling
    const handleOnlineList = (userIds: string[]) => dispatch(setGlobalOnlineUsers(userIds));
    const handleUserOnline = (data: { userId: string }) => {
      const current = onlineUsersRef.current;
      if (!current.includes(data.userId)) {
        dispatch(setGlobalOnlineUsers([...current, data.userId]));
      }
    };
    const handleUserOffline = (data: { userId: string }) => {
      const current = onlineUsersRef.current;
      dispatch(setGlobalOnlineUsers(current.filter((id: string) => id !== data.userId)));
    };

    socket.on('users:online-list', handleOnlineList);
    socket.on('user:online', handleUserOnline);
    socket.on('user:offline', handleUserOffline);

    const handleNewMessage = (msg: any) => {
      if (msg.receiverId === currentUser.id) {
        dispatch(incrementUnread(msg.senderId));
      }
    };

    const handleMessagesRead = (data: { readBy: string; senderId?: string }) => {
      if (data.readBy === currentUser.id && data.senderId) {
        dispatch(resetUnread(data.senderId));
      }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('messages:read-receipt', handleMessagesRead);

    // Global Data Sync - handled by debouncedInit effect, no need to duplicate here

    return () => {
      socket.off('org:role_changed', handleOrgUpdate);
      socket.off('org:membership_updated', handleOrgUpdate);
      socket.off('org:member_added', handleOrgUpdate);
      socket.off('org:member_removed');
      socket.off('people:updated', handlePeopleUpdate);
      socket.off('admin:screen-request');
      socket.off('webrtc:answer');
      socket.off('admin:ice-candidate');
      socket.off('webrtc:stop-share');
      socket.off('users:online-list', handleOnlineList);
      socket.off('user:online', handleUserOnline);
      socket.off('user:offline', handleUserOffline);
      socket.off('message:new', handleNewMessage);
      socket.off('messages:read-receipt', handleMessagesRead);
    };
  }, [currentUser, currentOrg, navigate, dispatch, refreshNotifications, fetchMembers, fetchUnreadMessageCounts]);


  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      let newWidth = e.clientX;
      if (newWidth < 68) newWidth = 68;
      if (newWidth > 600) newWidth = 600;
      if (sidebarRef.current) sidebarRef.current.style.width = `${newWidth}px`;
    };
    const handleMouseUp = (e: MouseEvent) => {
      setIsResizing(false);
      let finalWidth = e.clientX;
      if (finalWidth < 68) finalWidth = 68;
      if (finalWidth > 600) finalWidth = 600;
      if (finalWidth < 120) setIsSidebarMini(true);
      else {
        setIsSidebarMini(false);
        setSidebarWidth(finalWidth);
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const loadInitData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const params = currentOrg?.id ? `?orgId=${currentOrg.id}` : '';
      const res = await api.get(`/organizations/config/init${params}`);
      if (res.data.success) {
        const { organizations, currentOrg: resolvedOrg, spaces, favorites, assigned, members, unreadCounts } = res.data.data;

        dispatch(setOrganizations(organizations));
        if (resolvedOrg) {
          dispatch(setCurrentOrg({ org: resolvedOrg, role: resolvedOrg.role }));
        }

        setSpaces(spaces);
        setFavoriteTasks(favorites);
        setAssignedTasks(assigned);
        setMembers(members);
        dispatch(setAllUnread(unreadCounts));

        if (resolvedOrg?.id) {
          refreshNotifications(resolvedOrg.id);
        }
      }
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  }, [currentUser, currentOrg?.id, dispatch, refreshNotifications]);

  useEffect(() => {
    loadInitData();
  }, [loadInitData]);

  useEffect(() => {
    // Slack sidebar needs auth token; retry after refresh/login populates it.
    if (!accessToken) return;
    fetchSlackChannels();
  }, [fetchSlackChannels, accessToken]);

  const initTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedInit = useCallback(() => {
    if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
    initTimeoutRef.current = setTimeout(() => {
      loadInitData();
    }, 350); // Batch rapid socket bursts but keep sidebar/data feeling snappy
  }, [loadInitData]);

  useEffect(() => {
    if (!socket) return;
    const handleRefresh = () => {
      debouncedInit();
    };
    socket.on('task:updated', handleRefresh);
    socket.on('task:refresh', handleRefresh);
    socket.on('space:updated', handleRefresh);
    socket.on('people:updated', handleRefresh);
    socket.on('org:member_added', handleRefresh);

    return () => {
      socket.off('task:updated', handleRefresh);
      socket.off('task:refresh', handleRefresh);
      socket.off('space:updated', handleRefresh);
      socket.off('people:updated', handleRefresh);
      socket.off('org:member_added', handleRefresh);
    };
  }, [socket, debouncedInit]);

  const toggleSpace = (spaceId: string) => {
    setExpandedSpaces(prev => ({ ...prev, [spaceId]: !prev[spaceId] }));
  };

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const pageTitle = () => {
    if (location.pathname === '/') return 'Home';
    if (location.pathname === '/inbox') return 'Inbox';
    if (location.pathname.startsWith('/tasks/assigned')) {
      return location.search.includes('filter=today') ? 'Today & Overdue' : 'Assigned to me';
    }
    if (location.pathname.startsWith('/tasks/team')) return 'Team Message';
    if (location.pathname.startsWith('/people')) return 'People';
    if (location.pathname.startsWith('/settings')) return 'Settings';
    if (location.pathname.startsWith('/lists/')) return 'List';
    return 'Producteev';
  };

  const openCreateFolder = (spaceId: string) => {
    setActiveSpaceId(spaceId);
    setIsCreateFolderOpen(true);
  };

  const openCreateList = (spaceId: string, folderId?: string) => {
    setActiveSpaceId(spaceId);
    setActiveFolderId(folderId || null);
    setIsCreateListOpen(true);
  };

  // Auto-clear unread messages when viewing a chat
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const targetUserId = params.get('userId');
    if (targetUserId && location.pathname.startsWith('/tasks/team')) {
      if (unreadMessageCounts[targetUserId] > 0) {
        dispatch(markAsReadAction(targetUserId));
        socket?.emit('messages:read', { senderId: targetUserId });
      }
    }
  }, [location.pathname, location.search, unreadMessageCounts, socket, dispatch]);

  const openDeleteModal = (type: 'Space' | 'Folder' | 'List' | 'Organization', id: string, title: string) => {
    setDeleteData({ type, id, title });
  };

  const openRenameModal = (type: 'Space' | 'Folder' | 'List' | 'Organization', id: string, title: string) => {
    setRenameData({ type, id, title });
  };

  return (
    <div className="flex h-screen bg-[#F0F2F5] dark:bg-[#0B0D11] overflow-hidden font-sans text-[#1C1E21] selection:bg-indigo-100 selection:text-indigo-900">

      {/* Global Monitoring Modals (Top of DOM) */}
      {monitoringUser && (
        <ScreenShareModal
          onClose={() => setMonitoringUser(null)}
          targetUser={monitoringUser}
        />
      )}

      {screenRequest && (
        <ScreenRequestPrompt
          adminName={screenRequest.adminName || 'An Admin'}
          onAccept={handleAcceptScreen}
          onDecline={handleDeclineScreen}
        />
      )}
      {workspaceDropdownOpen && (
        <WorkspaceDropdownPanel
          coords={workspaceDropdownCoords}
          onClose={() => setWorkspaceDropdownOpen(false)}
        />
      )}


      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 overflow-y-auto overflow-x-hidden sidebar-scroll gradient-sidebar border-r border-gray-200/70 dark:border-gray-800 flex flex-col transform lg:relative lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${isResizing ? 'transition-none select-none' : 'transition-[width,transform] duration-300 ease-in-out'}`}
      >
        {/* Mobile Close Button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-600 transition-colors"
          title="Close Sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>

        <div className="relative px-4 py-4 border-b border-gray-100/80 dark:border-gray-800">
          <div ref={workspaceBtnRef} onClick={handleWorkspaceToggle} className={`flex items-center ${isSidebarMini ? 'justify-center' : 'justify-between'} w-full hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg p-1 cursor-pointer group/header`} title="Workspace Menu">
            <div className="flex items-center gap-3">
              <img
                src={PRODUCTEEV_LOGO_URL}
                alt="Producteev"
                className={`${isSidebarMini ? 'h-7 w-7' : 'h-9 w-auto'} object-contain shrink-0 transition-all duration-300`}
              />
            </div>

            {!isSidebarMini && (isOwner || isSuperAdmin) && (
              <div className="flex items-center gap-1.5 opacity-0 group-hover/header:opacity-100 transition-all duration-300">
                <>
                  <div className="w-px h-4 bg-gray-200 dark:bg-gray-700 mx-1" />
                  <button onClick={(e) => { e.stopPropagation(); navigate('/onboarding/workspace'); }} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Create Workspace">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                  </button>
                </>
              </div>
            )}
          </div>
        </div>

        <div className="px-2 py-2">
          <NavLink to="/" end onClick={handleSidebarLinkClick} className={({ isActive }) => `flex items-center ${isSidebarMini ? 'justify-center' : 'gap-2.5 px-3'} py-1.5 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            {!isSidebarMini && "Home"}
          </NavLink>
          <NavLink to="/inbox" onClick={handleSidebarLinkClick} className={({ isActive }) => `flex items-center relative ${isSidebarMini ? 'justify-center' : 'justify-between px-3'} py-1.5 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold shadow-sm' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
            <div className={`flex items-center ${isSidebarMini ? 'justify-center' : 'gap-2.5'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
              {!isSidebarMini && "Inbox"}
            </div>
            {!isSidebarMini && badgeCount > 0 && (
              <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-sm">
                {badgeCount}
              </span>
            )}
            {isSidebarMini && badgeCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black leading-none flex items-center justify-center border border-white dark:border-gray-900 shadow-sm">
                {badgeCount > 99 ? '99+' : badgeCount}
              </span>
            )}
          </NavLink>

          {false && showSlackNav && (
            <div
              className="relative"
              onMouseEnter={() => setSlackHoverOpen(true)}
              onMouseLeave={() => setSlackHoverOpen(false)}
            >
              <Link
                to="/slack"
                onClick={handleSidebarLinkClick}
                aria-current={isSlackSidebarRootActive ? 'page' : undefined}
                className={`flex items-center ${isSidebarMini ? 'justify-center' : 'gap-2.5 px-3'} py-1.5 rounded-lg text-[14px] transition-colors ${isSlackSidebarRootActive
                  ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold shadow-sm'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                  }`}
                title="Slack Channels"
              >
                <div className="relative w-7 h-7 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0 overflow-hidden border border-gray-200/70 dark:border-gray-800">
                  <img src={SLACK_ICON_URL} alt="Slack" className="w-full h-full object-cover" />
                  {showSlackIdentityStatus && slackConnected && (
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white/90 ${slackUserConnected ? 'bg-emerald-400' : 'bg-amber-400'
                        }`}
                      title={slackUserConnected ? 'Slack identity connected' : 'Slack identity not connected'}
                    />
                  )}
                </div>
                {!isSidebarMini && (
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="truncate">Slack</span>
                    {slackUnreadCount > 0 && (
                      <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-sm">
                        {slackUnreadCount > 99 ? '99+' : slackUnreadCount}
                      </span>
                    )}
                    {showSlackIdentityStatus && slackConnected && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            if (slackUserConnected) await disconnectSlackIdentity();
                            else await connectSlackIdentity();
                          } catch {
                            // SlackPage will show detailed errors; keep sidebar lightweight.
                          }
                        }}
                        className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-lg border transition-colors ${slackUserConnected
                          ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-200 dark:border-amber-900/40 bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-900/10 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                          }`}
                        title={slackUserConnected ? 'Disconnect Slack identity' : 'Connect Slack identity'}
                      >
                        {slackUserConnected ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M10 13a5 5 0 007 0l1-1a5 5 0 00-7-7l-1 1"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                            <path
                              d="M14 11a5 5 0 00-7 0l-1 1a5 5 0 007 7l1-1"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <path
                              d="M9 3v6m6-6v6M7 9h10v3a5 5 0 01-5 5 5 5 0 01-5-5V9z"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                            <path d="M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                )}
                {isSidebarMini && slackUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-black leading-none flex items-center justify-center border border-white dark:border-gray-900 shadow-sm">
                    {slackUnreadCount > 99 ? '99+' : slackUnreadCount}
                  </span>
                )}
              </Link>

              {/* Mini sidebar: show channels in hover panel */}
              {isSidebarMini && slackHoverOpen && slackConnected && slackChannels.length > 0 && (
                <div className="absolute left-full top-0 ml-2 w-[240px] rounded-xl border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-[#121826]/95 shadow-2xl backdrop-blur z-[9999] overflow-hidden">
                  <div className="px-3 py-2 text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800">
                    Channels
                  </div>
                  <div className="max-h-[320px] overflow-y-auto sidebar-scroll p-1">
                    {slackChannels.slice(0, 50).map((c) => {
                      const channelActive = slackSidebarChannelId === c.id;
                      return (
                        <Link
                          key={c.id}
                          to={`/slack?channelId=${encodeURIComponent(c.id)}`}
                          onClick={() => setSlackSidebarUnreadByChannel((prev) => {
                            if (!prev?.[c.id]) return prev;
                            const { [c.id]: _drop, ...rest } = prev;
                            return rest;
                          })}
                          aria-current={channelActive ? 'page' : undefined}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors ${channelActive ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                            }`}
                        >
                          <span className="text-gray-400">#</span>
                          <span className="truncate flex-1 min-w-0">{c.name}</span>
                          {(slackUnreadByChannel[c.id] || slackSidebarUnreadByChannel[c.id]) ? (
                            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black leading-none flex items-center justify-center">
                              {(() => {
                                const v = (slackUnreadByChannel[c.id] || 0) + (slackSidebarUnreadByChannel[c.id] || 0);
                                return v > 99 ? '99+' : v;
                              })()}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {false && !isSidebarMini && slackConnected && slackChannels.length > 0 && (
            <div className="ml-8 mt-1 mb-2 space-y-0.5">
              <button
                type="button"
                onClick={() => {
                  setIsSlackChannelsExpanded((v) => {
                    const next = !v;
                    try {
                      localStorage.setItem(SLACK_CH_EXPANDED_STORAGE, next ? '1' : '0');
                    } catch {
                      /* ignore */
                    }
                    return next;
                  });
                }}
                className="flex items-center gap-1 w-full text-left px-2 py-1 rounded-md text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest hover:bg-gray-100/80 dark:hover:bg-gray-800/50 transition-colors"
              >
                <svg
                  className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${isSlackChannelsExpanded ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                Channels
              </button>
              {isSlackChannelsExpanded && (
                <div className="space-y-0.5">
                  {slackChannels.slice(0, 20).map((c) => {
                    const channelActive = slackSidebarChannelId === c.id;
                    return (
                      <Link
                        key={c.id}
                        to={`/slack?channelId=${encodeURIComponent(c.id)}`}
                        onClick={() => {
                          setSlackSidebarUnreadByChannel((prev) => {
                            if (!prev?.[c.id]) return prev;
                            const { [c.id]: _drop, ...rest } = prev;
                            return rest;
                          });
                          handleSidebarLinkClick();
                        }}
                        aria-current={channelActive ? 'page' : undefined}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${channelActive ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                          }`}
                      >
                        <span className="text-gray-400">#</span>
                        <span className="truncate flex-1 min-w-0">{c.name}</span>
                        {(slackUnreadByChannel[c.id] || slackSidebarUnreadByChannel[c.id]) ? (
                          <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black leading-none flex items-center justify-center">
                            {(() => {
                              const v = (slackUnreadByChannel[c.id] || 0) + (slackSidebarUnreadByChannel[c.id] || 0);
                              return v > 99 ? '99+' : v;
                            })()}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                  {slackChannels.length > 20 && (
                    <Link
                      to="/slack"
                      onClick={handleSidebarLinkClick}
                      className="block px-3 py-1.5 text-[12px] font-black text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      View all…
                    </Link>
                  )}
                </div>
              )}
            </div>
          )}

          {(isSuperAdmin || isOwner) && (
            <NavLink to="/admin/recovery" onClick={handleSidebarLinkClick} className={({ isActive }) => `flex items-center ${isSidebarMini ? 'justify-center' : 'gap-2.5 px-2'} py-1.5 rounded-lg text-[13px] transition-colors ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50'}`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              {!isSidebarMini && "Recovery Panel"}
            </NavLink>
          )}
        </div>

        {showFullSidebar && (
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto sidebar-scroll">
            {/* My Tasks Section */}
            <div className={`px-2 ${isSidebarMini ? 'py-1' : 'py-2'} border-b border-gray-100 dark:border-gray-800`}>
              <button
                onClick={() => setIsMyTasksExpanded(!isMyTasksExpanded)}
                className={`flex items-center gap-2.5 px-3 py-1.5 w-full hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg text-gray-600 dark:text-gray-300 transition-all ${isMyTasksExpanded ? 'mb-1' : ''}`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                    <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="8.5" cy="7" r="4" />
                    <path d="M17 11l2 2 4-4" />
                  </svg>
                  {!isSidebarMini && <span className="text-[14px] font-bold tracking-tight">My Tasks</span>}
                </div>
              </button>

              {!isSidebarMini && isMyTasksExpanded && (
                <div className="space-y-0.5 ml-0.5">
                  <NavLink
                    to="/tasks/assigned"
                    className={({ isActive }) => `flex items-center gap-3 px-8 py-1.5 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                  >
                    <div className="w-5 h-5 rounded-md bg-rose-500 flex items-center justify-center text-[10px] text-white font-black shadow-sm shrink-0 overflow-hidden">
                      {currentUser?.avatarUrl ? (
                        <img src={currentUser.avatarUrl} alt="Your avatar" className="w-full h-full object-cover" />
                      ) : (
                        (currentUser?.firstName?.charAt(0) || 'U').toUpperCase()
                      )}
                    </div>
                    <span className="truncate">Assigned to me</span>
                  </NavLink>
                  <NavLink
                    to="/tasks/assigned?filter=today"
                    className={({ isActive }) => `flex items-center justify-between px-8 py-1.5 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      <span className="truncate">Today & Overdue</span>
                    </div>
                    {assignedTasks.filter(t => t.dueDate && new Date(t.dueDate) <= new Date() && t.status !== 'CLOSED').length > 0 && (
                      <span className="text-[11px] font-bold text-gray-400 tabular-nums flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        {assignedTasks.filter(t => t.dueDate && new Date(t.dueDate) <= new Date() && t.status !== 'CLOSED').length}
                      </span>
                    )}
                  </NavLink>
                </div>
              )}
            </div>
            {(isAdmin || isMember) && !isGuest && (
              <div className={`px-2 ${isSidebarMini ? 'py-1' : 'py-3'} border-t border-gray-100 dark:border-gray-700`}>
                <div className={`flex items-center ${isSidebarMini ? 'justify-center' : 'justify-between px-2'} mb-2 group/spaces`}>
                  {!isSidebarMini && (
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest leading-tight">Spaces</span>
                      <span className="text-[9px] font-black text-indigo-500/80 dark:text-indigo-400/80 uppercase truncate max-w-[140px] tracking-tighter" title={currentOrg?.name}>in {currentOrg?.name}</span>
                    </div>
                  )}
                  {canCreateSpace && (
                    <button
                      onClick={() => setIsCreateSpaceOpen(true)}
                      className={`p-1.5 hover:bg-white dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-indigo-600 transition-all hover:shadow-sm active:scale-90 ${isSidebarMini ? 'mx-auto' : ''}`}
                      title="Create Space"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {spaces.map(space => (
                    <div key={space.id} className="space-item group/space">
                      <div className={`flex items-center group/space mb-0.5 ${isSidebarMini ? 'justify-center w-full' : ''}`}>
                        <div className={`flex items-center ${isSidebarMini ? 'justify-center w-full' : 'flex-1 justify-between group/btn px-2 py-2 rounded-lg hover:bg-gray-100/50 dark:hover:bg-gray-800/50 transition-all'}`}>
                          <button
                            className={`flex items-center ${isSidebarMini ? 'justify-center p-2' : 'gap-3 min-w-0'}`}
                          >
                            {currentOrg?.settings?.logoUrl ? (
                              <div className="w-[26px] h-[26px] rounded-[7px] overflow-hidden shrink-0 shadow-sm border border-gray-200 dark:border-gray-700 transition-transform group-hover/btn:scale-110">
                                <img src={resolveAssetUrl(currentOrg.settings.logoUrl)} alt={space.name} className="w-full h-full object-cover" />
                              </div>
                            ) : (
                              <SpaceIcon
                                color={space.color || '#6366f1'}
                                icon={space.icon}
                                name={space.name}
                                isAdmin={isAdmin}
                                onClick={(e) => {
                                  if (isAdmin) {
                                    e.stopPropagation();
                                    navigate(`/spaces/${space.id}/dashboard`);
                                  } else {
                                    toggleSpace(space.id);
                                  }
                                }}
                              />
                            )}
                            {!isSidebarMini && (
                              <div className="flex items-center gap-2 min-w-0" onClick={() => toggleSpace(space.id)}>
                                <span className="text-[14px] font-bold text-gray-700 dark:text-gray-200 truncate tracking-tight">{space.name}</span>
                                <svg className="w-4 h-4 text-gray-400 shrink-0 opacity-80" fill="currentColor" viewBox="0 0 24 24"><path fillRule="evenodd" d="M12 1.5a5.25 5.25 0 00-5.25 5.25v3a3 3 0 00-3 3v6.75a3 3 0 003 3h10.5a3 3 0 003-3v-6.75a3 3 0 00-3-3v-3c0-2.9-2.35-5.25-5.25-5.25zm3.75 8.25v-3a3.75 3.75 0 10-7.5 0v3h7.5z" clipRule="evenodd" /></svg>
                              </div>
                            )}
                          </button>
                          {!isSidebarMini && canManageSpaces && (
                            <div className="flex items-center gap-1">
                              <div className="relative" data-plus-menu>
                                <button
                                  onClick={() => setIsPlusMenuOpen(isPlusMenuOpen === space.id ? null : space.id)}
                                  className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${isPlusMenuOpen === space.id ? 'text-indigo-600' : 'text-gray-400'}`}
                                  title="More"
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" className="opacity-70"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                                </button>
                                {isPlusMenuOpen === space.id && (
                                  <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 z-[100] py-1.5 overflow-hidden animate-scale-in origin-top-right">

                                    <button onClick={(e) => { e.stopPropagation(); openCreateList(space.id); setIsPlusMenuOpen(null); }} className="w-full text-left px-4 py-2 text-[13px] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-gray-700 dark:text-gray-200 flex items-center gap-2 group transition-colors"><div className="w-1 h-1 rounded-full bg-emerald-400 group-hover:scale-150 transition-transform" />Create List</button>
                                    <div className="my-1.5 border-t border-gray-100 dark:border-gray-700/50" />
                                    <button onClick={(e) => { e.stopPropagation(); openRenameModal('Space', space.id, space.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-4 py-2 text-[12px] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700">Rename Space</button>
                                    {(isOwner || isSuperAdmin || isAdmin) && (
                                      <button onClick={(e) => { e.stopPropagation(); openDeleteModal('Space', space.id, space.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-4 py-2 text-[12px] text-red-500 font-medium hover:bg-red-50 dark:hover:bg-red-900/10">Delete Space</button>
                                    )}
                                  </div>
                                )}
                              </div>

                            </div>
                          )}
                        </div>
                      </div>
                      {!isSidebarMini && expandedSpaces[space.id] && (
                        <div className="ml-5 pl-4 border-l border-gray-100/80 dark:border-gray-800/80 mt-1 space-y-0.5">
                          {space.folders.map(folder => (
                            <div key={folder.id} className="group/folder px-2">
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => toggleFolder(folder.id)}
                                  className="flex-1 flex items-center gap-2 py-1 px-1 rounded-md text-[12px] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                >
                                  <svg className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expandedFolders[folder.id] ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                  <span className="truncate flex-1 text-left font-medium">{folder.name}</span>
                                </button>
                                {canManageSpaces && (
                                  <div className="relative shrink-0" data-plus-menu>
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsPlusMenuOpen(isPlusMenuOpen === folder.id ? null : folder.id); }}
                                      className={`opacity-0 group-hover/folder:opacity-100 p-0.5 rounded transition-all ${isPlusMenuOpen === folder.id ? 'bg-indigo-100 text-indigo-600 opacity-100' : 'text-gray-400 hover:text-indigo-500'}`}
                                      title="Folder Options"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                    </button>
                                    {isPlusMenuOpen === folder.id && (
                                      <div className="absolute right-0 top-full mt-1 w-36 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 z-[100] py-1 overflow-hidden animate-scale-in origin-top-right">
                                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openCreateList(space.id, folder.id); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Create List</button>
                                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRenameModal('Folder', folder.id, folder.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Rename Folder</button>
                                        <div className="my-1.5 border-t border-gray-100 dark:border-gray-700" />
                                        {(isOwner || isSuperAdmin || isAdmin) && (
                                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDeleteModal('Folder', folder.id, folder.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-medium">Delete Folder</button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              {expandedFolders[folder.id] && (
                                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-gray-100 dark:border-gray-800">
                                  {folder.lists.map(list => (
                                    <div key={list.id} className="group/list-item flex items-center relative gap-0.5 pr-2">
                                      <NavLink
                                        to={`/lists/${list.id}`}
                                        className={({ isActive }) => `flex-1 flex items-center gap-3 pl-3 pr-2 py-1.5 rounded-lg text-[14px] transition-all ${isActive ? 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}
                                      >
                                        <svg className="w-4 h-4 shrink-0 text-gray-400/80 group-hover/list-item:text-gray-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M9 6h11M9 12h11M9 18h11" />
                                          <path d="M5 6v.01M5 12v.01M5 18v.01" />
                                        </svg>
                                        <span className="truncate flex-1 tracking-tight">{list.name}</span>
                                        {list._count && list._count.tasks > 0 && (
                                          <span className="text-[11px] font-bold text-gray-400/70 dark:text-gray-500/70 tabular-nums">{list._count.tasks}</span>
                                        )}
                                      </NavLink>

                                      {canManageSpaces && (
                                        <span data-plus-menu>
                                          <button
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsPlusMenuOpen(isPlusMenuOpen === list.id ? null : list.id); }}
                                            className={`opacity-0 group-hover/list-item:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-all ${isPlusMenuOpen === list.id ? 'text-indigo-600 opacity-100 bg-gray-100' : 'text-gray-400'}`}
                                            title="List Options"
                                          >
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                                          </button>

                                          {isPlusMenuOpen === list.id && (
                                            <div className="absolute right-2 top-full mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 z-[100] py-1 animate-scale-in origin-top-right">
                                              <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRenameModal('List', list.id, list.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium">Rename List</button>
                                              {(isOwner || isSuperAdmin || isAdmin) && (
                                                <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDeleteModal('List', list.id, list.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-medium">Delete List</button>
                                              )}
                                            </div>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                          {space.lists?.map(list => (
                            <div key={list.id} className="group/list-item flex items-center relative gap-0.5 pr-2">
                              <NavLink
                                to={`/lists/${list.id}`}
                                className={({ isActive }) => `flex-1 flex items-center gap-3 pl-3 pr-2 py-1.5 rounded-lg text-[14px] transition-all ${isActive ? 'bg-gray-100/80 dark:bg-gray-800 text-gray-900 dark:text-white font-bold' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50/50 dark:hover:bg-gray-800/30'}`}
                              >
                                <svg className="w-4 h-4 shrink-0 text-gray-400/80 group-hover/list-item:text-gray-600 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M9 6h11M9 12h11M9 18h11" />
                                  <path d="M5 6v.01M5 12v.01M5 18v.01" />
                                </svg>
                                <span className="truncate flex-1 tracking-tight">{list.name}</span>
                                {list._count && list._count.tasks > 0 && (
                                  <span className="text-[11px] font-bold text-gray-400/70 dark:text-gray-500/70 tabular-nums">{list._count.tasks}</span>
                                )}
                              </NavLink>

                              {canManageSpaces && (
                                <span data-plus-menu>
                                  <button
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setIsPlusMenuOpen(isPlusMenuOpen === list.id ? null : list.id); }}
                                    className={`opacity-0 group-hover/list-item:opacity-100 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-all ${isPlusMenuOpen === list.id ? 'text-indigo-600 opacity-100 bg-gray-100' : 'text-gray-400'}`}
                                    title="List Options"
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                                  </button>

                                  {isPlusMenuOpen === list.id && (
                                    <div className="absolute right-2 top-full mt-1 w-32 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-100 dark:border-gray-700 z-[100] py-1 animate-scale-in origin-top-right">
                                      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openRenameModal('List', list.id, list.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium">Rename List</button>
                                      {(isOwner || isSuperAdmin || isAdmin) && (
                                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDeleteModal('List', list.id, list.name); setIsPlusMenuOpen(null); }} className="w-full text-left px-3 py-1.5 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors font-medium">Delete List</button>
                                      )}
                                    </div>
                                  )}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showSlackNav && (
              <div className={`px-2 ${isSidebarMini ? 'py-1' : 'py-2'} border-t border-gray-100 dark:border-gray-700`}>
                <Link
                  to="/slack"
                  onClick={handleSidebarLinkClick}
                  aria-current={isSlackSidebarRootActive ? 'page' : undefined}
                  className={`flex items-center ${isSidebarMini ? 'justify-center' : 'gap-2.5 px-3'} py-1.5 rounded-lg text-[14px] transition-colors ${isSlackSidebarRootActive
                    ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  title="Slack Channels"
                >
                  <div className="relative w-7 h-7 rounded-xl bg-white flex items-center justify-center shadow-sm shrink-0 overflow-hidden border border-gray-200/70 dark:border-gray-800">
                    <img src={SLACK_ICON_URL} alt="Slack" className="w-full h-full object-cover" />
                    {showSlackIdentityStatus && slackConnected && (
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-white/90 ${slackUserConnected ? 'bg-emerald-400' : 'bg-amber-400'
                          }`}
                        title={slackUserConnected ? 'Slack identity connected' : 'Slack identity not connected'}
                      />
                    )}
                  </div>
                  {!isSidebarMini && (
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                      <span className="truncate">Slack</span>
                      {slackUnreadCount > 0 && (
                        <span className="px-1.5 py-0.5 bg-rose-500 text-white text-[10px] font-black rounded-full shadow-sm">
                          {slackUnreadCount > 99 ? '99+' : slackUnreadCount}
                        </span>
                      )}
                      {showSlackIdentityStatus && slackConnected && (
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              if (slackUserConnected) await disconnectSlackIdentity();
                              else await connectSlackIdentity();
                            } catch {
                              // SlackPage will show detailed errors; keep sidebar lightweight.
                            }
                          }}
                          className={`shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-lg border transition-colors ${slackUserConnected
                              ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 hover:bg-emerald-100/70 dark:bg-emerald-900/10 dark:hover:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                              : 'border-amber-200 dark:border-amber-900/40 bg-amber-50 hover:bg-amber-100/70 dark:bg-amber-900/10 dark:hover:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                            }`}
                          title={slackUserConnected ? 'Disconnect Slack identity' : 'Connect Slack identity'}
                        >
                          {slackUserConnected ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M10 13a5 5 0 007 0l1-1a5 5 0 00-7-7l-1 1"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                              <path
                                d="M14 11a5 5 0 00-7 0l-1 1a5 5 0 007 7l1-1"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                            </svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                              <path
                                d="M9 3v6m6-6v6M7 9h10v3a5 5 0 01-5 5 5 5 0 01-5-5V9z"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                              <path d="M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </Link>
                {!isSidebarMini && slackConnected && slackChannels.length > 0 && (
                  <div className="ml-8 mt-1 mb-2 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSlackChannelsExpanded((v) => {
                          const next = !v;
                          try {
                            localStorage.setItem(SLACK_CH_EXPANDED_STORAGE, next ? '1' : '0');
                          } catch {
                            /* ignore */
                          }
                          return next;
                        });
                      }}
                      className="flex items-center gap-1 w-full text-left px-2 py-1 rounded-md text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest hover:bg-gray-100/80 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <svg
                        className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${isSlackChannelsExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      Channels
                    </button>
                    {isSlackChannelsExpanded && (
                      <div className="space-y-0.5">
                        {slackChannels.slice(0, 20).map((c) => {
                          const channelActive = slackSidebarChannelId === c.id;
                          return (
                            <Link
                              key={c.id}
                              to={`/slack?channelId=${encodeURIComponent(c.id)}`}
                              onClick={() => {
                                setSlackSidebarUnreadByChannel((prev) => {
                                  if (!prev?.[c.id]) return prev;
                                  const { [c.id]: _drop, ...rest } = prev;
                                  return rest;
                                });
                                handleSidebarLinkClick();
                              }}
                              aria-current={channelActive ? 'page' : undefined}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-colors ${channelActive ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-bold' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40'
                                }`}
                            >
                              <span className="text-gray-400">#</span>
                              <span className="truncate flex-1 min-w-0">{c.name}</span>
                              {(slackUnreadByChannel[c.id] || slackSidebarUnreadByChannel[c.id]) ? (
                                <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black leading-none flex items-center justify-center">
                                  {(() => {
                                    const v = (slackUnreadByChannel[c.id] || 0) + (slackSidebarUnreadByChannel[c.id] || 0);
                                    return v > 99 ? '99+' : v;
                                  })()}
                                </span>
                              ) : null}
                            </Link>
                          );
                        })}
                        {slackChannels.length > 20 && (
                          <Link
                            to="/slack"
                            onClick={handleSidebarLinkClick}
                            className="block px-3 py-1.5 text-[12px] font-black text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            View all…
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className={`px-2 ${isSidebarMini ? 'py-1' : 'py-3'} border-t border-gray-100 dark:border-gray-700`}>
              <div className={`flex items-center ${isSidebarMini ? 'justify-center mt-1 mb-1' : 'justify-between px-2 mb-1'} group/fav-header`}>
                <button
                  onClick={() => setIsFavoritesOpen(!isFavoritesOpen)}
                  className={`flex items-center ${isSidebarMini ? 'justify-center' : 'gap-1.5'} min-w-0 hover:text-indigo-600 transition-colors`}
                  disabled={isSidebarMini}
                >
                  {!isSidebarMini && (
                    <>
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442a.562.562 0 0 1 .321.988l-4.204 3.602a.562.562 0 0 0-.182.557l1.285 5.386a.562.562 0 0 1-.84.61l-4.725-2.886a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557L3.041 10.385a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                      </svg>
                      <span className="text-[14px] font-bold text-gray-700 dark:text-gray-300 tracking-tight">Favorites</span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${isFavoritesOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                    </>
                  )}
                  {isSidebarMini && (
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                    </svg>
                  )}
                </button>
                {!isSidebarMini && favoriteTasks.length > 5 && isFavoritesOpen && (
                  <button
                    onClick={() => setShowAllFavorites(!showAllFavorites)}
                    className="text-[11px] text-indigo-500 hover:underline font-bold"
                  >
                    {showAllFavorites ? 'Show Less' : `View All (${favoriteTasks.length})`}
                  </button>
                )}
              </div>
              <div className="space-y-0.5">
                {isFavoritesOpen && (showAllFavorites ? favoriteTasks : favoriteTasks.slice(0, 5)).map(task => (
                  <NavLink key={task.id} to={`/tasks/${task.id}`} state={{ backgroundLocation: location }} className={({ isActive }) => `flex items-start ${isSidebarMini ? 'justify-center' : 'gap-2.5 px-3'} py-2 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold' : 'text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                    <div className="w-4 h-4 rounded-full border-2 border-gray-400 dark:border-gray-600 shrink-0 mt-0.5 transition-colors group-hover:border-indigo-500" />
                    {!isSidebarMini && (
                      <div className="flex-1 min-w-0 flex items-center justify-between gap-2 overflow-hidden pr-1">
                        <span className="truncate tracking-tight font-medium shrink min-w-0" title={task.title}>{task.title}</span>
                        {task.tags && task.tags.length > 0 && (
                          <div className="flex items-center gap-1 shrink-0 ml-auto pointer-events-none">
                            {task.tags.slice(0, 1).map(t => (
                              <TaskTagDot key={t.id} color={t.color || '#3b82f6'} name={t.name} />
                            ))}
                            {task.tags.length > 1 && (
                              <div className="text-[9px] text-gray-400 font-bold dark:text-gray-500 bg-gray-100 dark:bg-gray-800/50 px-1 rounded-sm shrink-0">
                                +{task.tags.length - 1}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>

            <div className={`px-2 ${isSidebarMini ? 'py-1' : 'py-3'} border-t border-gray-100 dark:border-gray-700`}>
              {!isSidebarMini && (
                <div className="flex items-center justify-between px-2 py-1 text-[13px] text-gray-600 dark:text-gray-400 uppercase tracking-widest font-bold opacity-80 mb-1">
                  <span>Direct Messages</span>
                  {members.length > members.filter((m: any) => (m.user?.id === currentUser?.id) || (unreadMessageCounts[m.user?.id || ''] > 0)).length && (
                    <button
                      onClick={() => setShowAllMembers(!showAllMembers)}
                      className="text-[10px] text-indigo-500 hover:underline lowercase font-normal"
                    >
                      {showAllMembers ? 'Show Less' : `View All (${members.length})`}
                    </button>
                  )}
                </div>
              )}
              <div className={`${isSidebarMini ? '' : 'pl-1 ml-1'} ${isSidebarMini ? 'mt-0' : 'mt-1'} space-y-0.5 relative font-sans`}>
                {members
                  .filter((m: any) => {
                    if (showAllMembers) return true;
                    const isMe = m.user?.id === currentUser?.id;
                    const hasUnread = (unreadMessageCounts[m.user?.id || ''] || 0) > 0;
                    return isMe || hasUnread;
                  })
                  .sort((a, b) => {
                    // 1) Place current user first
                    if (a.user?.id === currentUser?.id) return -1;
                    if (b.user?.id === currentUser?.id) return 1;

                    // 2) Then show conversations with unread messages first
                    const aUnread = unreadMessageCounts[a.user?.id || ''] || 0;
                    const bUnread = unreadMessageCounts[b.user?.id || ''] || 0;
                    if (aUnread !== bUnread) return bUnread - aUnread;

                    // 3) Finally sort alphabetically by first name
                    const aName = (a.user?.firstName || '').toLowerCase();
                    const bName = (b.user?.firstName || '').toLowerCase();
                    return aName.localeCompare(bName);
                  })
                  .map((m: any) => {
                    const user = m.user;
                    if (!user) return null;
                    const isOnline = onlineUsers.has(user.id);
                    const isMe = user.id === currentUser?.id;
                    const unreadMsgCount = unreadMessageCounts[user.id] || 0;

                    return (
                      <NavLink
                        key={user.id}
                        to={`/tasks/team?userId=${user.id}`}
                        onClick={() => {
                          dispatch(markAsReadAction(user.id));
                        }}
                        className={({ isActive }) => `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[14px] transition-colors ${isActive ? 'bg-gray-100 dark:bg-indigo-900/30 text-gray-900 dark:text-indigo-400 font-semibold' : 'text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                      >
                        <div className="relative shrink-0">
                          <div className={`w-7 h-7 rounded-lg ${isMe ? 'bg-indigo-500' : 'bg-gray-400'} text-white flex items-center justify-center text-[11px] font-bold shadow-sm overflow-hidden relative`}>
                            {/* Initials are ALWAYS in the background */}
                            {user.firstName?.charAt(0).toUpperCase() || 'U'}

                            {/* Image sits on top. If missing, backend sends transparent pixel, showing the initials. */}
                            {user.avatarUrl && (
                              <img
                                src={user.avatarUrl}
                                alt=""
                                className="absolute inset-0 w-full h-full object-cover"
                              />
                            )}
                          </div>
                          {isOnline && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white dark:border-[#0F172A]" />
                          )}
                        </div>
                        {!isSidebarMini && (
                          <div className="flex-1 min-w-0 flex items-center justify-between group/dm-item">
                            <span className="truncate">
                              {user.firstName} {user.lastName} {isMe && "(You)"}
                            </span>
                            {unreadMsgCount > 0 && (
                              <div className="flex items-center justify-center w-5 h-5 bg-indigo-500 text-white text-[10px] font-black rounded-full shadow-lg ring-2 ring-white dark:ring-gray-950 animate-bounce shrink-0 ml-2">
                                {unreadMsgCount}
                              </div>
                            )}
                            {isMe && (
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  // Trigger the existing avatar upload logic or a simple alert for now
                                  document.getElementById('user-avatar-upload')?.click();
                                }}
                                className="hidden group-hover/dm-item:flex p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                title="Upload Profile Image"
                              >
                                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </button>
                            )}
                          </div>
                        )}
                      </NavLink>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 mt-auto sticky bottom-0 bg-gray-50/90 dark:bg-gray-950/90 backdrop-blur">
          <button onClick={() => setIsSidebarMini(!isSidebarMini)} className="flex items-center justify-center w-full py-1.5 rounded-lg text-gray-400 hover:text-gray-600 transition-colors" title={isSidebarMini ? "Expand Sidebar" : "Collapse Sidebar"}>
            {isSidebarMini ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>}
          </button>
        </div>

        <div onMouseDown={startResizing} className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-50 hover:bg-indigo-500 transition-colors hidden lg:block" />

      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="px-3 sm:px-4 py-2 flex sm:py-2.5 items-center gap-2 sm:gap-4 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur z-30">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-1.5 text-gray-600 hover:text-gray-900" title="Open Menu"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300" title="Go back"><svg className="w-4.5 h-4.5 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
            <h2 className="hidden sm:block text-sm font-bold text-gray-800 dark:text-gray-200 tracking-tight">{pageTitle()}</h2>
          </div>
          <div className="flex-1 flex justify-center min-w-0"><SearchTrigger onClick={() => setSearchOpen(true)} /></div>
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <GlobalTimer />
            <NotificationBell />
            <button onClick={toggleThemeMode} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title={isDark ? "Light Mode" : "Dark Mode"}>
              {isDark ? <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg> : <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>}
            </button>
            <div className="relative" ref={userDropdownRef}>
              <button onClick={() => setUserDropdownOpen(!userDropdownOpen)} className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center text-xs font-semibold hover:ring-2 hover:ring-purple-300 transition-all overflow-hidden shrink-0 relative" title="User Menu">
                {currentUser?.firstName?.charAt(0).toUpperCase()}
                {currentUser?.avatarUrl && (
                  <img
                    src={currentUser.avatarUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                )}
              </button>
              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-[#1E2530] rounded-xl shadow-xl border border-gray-100 dark:border-gray-800 py-1 z-50 overflow-hidden animate-scale-in origin-top-right">
                  <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800">
                    <div className="text-sm font-bold text-gray-900 dark:text-white truncate">{currentUser?.firstName} {currentUser?.lastName}</div>
                    <div className="text-[11px] text-gray-500 truncate">{currentUser?.email}</div>
                  </div>
                  <button onClick={() => { navigate('/settings'); setUserDropdownOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">Settings</button>
                  {(isAdmin) && (
                    <button onClick={() => { navigate('/people'); setUserDropdownOpen(false); }} className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50">Manage People</button>
                  )}
                  <div className="border-t border-gray-100 dark:border-gray-800 my-1" />
                  <button onClick={logout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 hover:text-red-700 font-medium">Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="flex-1 flex flex-col min-h-0 overflow-hidden min-w-0 bg-[#F0F2F5] dark:bg-[#0B0D11]">
          <Outlet context={{ setMonitoringUser }} />
        </div>
      </div>
      {incomingCall && (
        <VideoCallModal
          onClose={handleDeclineCall}
          onAccept={handleAcceptCall}
          isReceiving={true}
          targetUser={{
            name: incomingCall.callerName,
            initials: (incomingCall.callerName || '').split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase() || '?',
            color: '#6366f1' // Default color for incoming
          }}
        />
      )}
      {screenRequest && (
        <ScreenRequestPrompt
          adminName={screenRequest.adminName || 'Organization Admin'}
          onAccept={handleAcceptScreen}
          onDecline={handleDeclineScreen}
        />
      )}
      <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      {isCreateFolderOpen && activeSpaceId && <CreateFolderModal spaceId={activeSpaceId} onClose={() => setIsCreateFolderOpen(false)} onSuccess={fetchSpaces} />}
      {isCreateListOpen && activeSpaceId && <CreateListModal spaceId={activeSpaceId} folderId={activeFolderId || undefined} onClose={() => setIsCreateListOpen(false)} onSuccess={fetchSpaces} />}
      {renameData && (
        <RenameModal
          type={renameData.type}
          id={renameData.id}
          initialTitle={renameData.title}
          onClose={() => setRenameData(null)}
          onSuccess={() => {
            if (renameData.type === 'Organization') {
              // Refresh organizations
              window.location.reload();
            } else {
              fetchSpaces();
            }
          }}
        />
      )}

      {deleteData && (
        <DeleteConfirmModal
          type={deleteData.type}
          id={deleteData.id}
          title={deleteData.title}
          onClose={() => setDeleteData(null)}
          onSuccess={() => {
            if (deleteData.type === 'Organization') {
              // If deleted current org, redirect or switch
              if (deleteData.id === currentOrg?.id) {
                navigate('/');
                window.location.reload();
              } else {
                window.location.reload();
              }
            } else {
              fetchSpaces();
            }
          }}
        />
      )}
      {isCreateSpaceOpen && (
        <CreateSpaceModal
          onClose={() => setIsCreateSpaceOpen(false)}
          onSuccess={fetchSpaces}
        />
      )}

      {/* Hidden Avatar Upload Input */}
      <input
        type="file"
        id="user-avatar-upload"
        className="hidden"
        accept="image/*"
        onChange={handleGlobalAvatarUpload}
        disabled={isUploadingAvatar}
        title="Upload Avatar"
        aria-label="Upload Avatar"
      />
    </div>
  );
}
