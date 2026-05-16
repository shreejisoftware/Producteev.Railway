import { useState, useMemo, useEffect, useRef } from 'react';
import { Mail, Zap, Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useNotifications } from '../../hooks/useNotifications';
import { useSocket } from '../../hooks/useSocket';
import { extractTaskId, getSeenTsForNotif, extractOrganizationId } from '../../utils/notificationUtils';
import { getCommentSummary } from '../../components/activity/CommentContent';
import { useOrgRole } from '../../hooks/useOrgRole';
import { motion, AnimatePresence } from 'framer-motion';
import { Notification } from '../../types/notification.types';
import { EmptyNotifications } from '../../components/ui/EmptyState';
import api from '../../services/api';
import { resolveAssetUrl } from '../../utils/assetUrl';

const INBOX_TABS = [
  {
    id: 'Primary', label: 'Primary',
    icon: <Mail size={16} />,
    color: 'text-indigo-600'
  },
  {
    id: 'Other', label: 'Other',
    icon: <Zap size={16} />,
    color: 'text-amber-500'
  },
  {
    id: 'Cleared', label: 'Cleared',
    icon: <Check size={16} />,
    color: 'text-blue-500'
  },
];

function UserAvatar({ notif }: { notif: Notification }) {
  const ref = useRef<HTMLDivElement>(null);
  const initials = notif.message.split(' ')[0].substring(0, 2).toUpperCase();
  const hue = notif.id.charCodeAt(0) * 47 % 360;

  useEffect(() => {
    if (ref.current) {
      ref.current.style.background = `linear-gradient(135deg, hsl(${hue},70%,55%), hsl(${hue},80%,38%))`;
    }
  }, [hue]);

  return (
    <div
      ref={ref}
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
    >
      {initials}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const configs: Record<string, { color: string; percent: number }> = {
    'OPEN': { color: '#94a3b8', percent: 5 },
    'PENDING': { color: '#f59e0b', percent: 25 },
    'IN_PROGRESS': { color: '#d946ef', percent: 50 },
    'IN_REVIEW': { color: '#f97316', percent: 75 },
    'ACCEPTED': { color: '#ef4444', percent: 100 },
    'REJECTED': { color: '#8b5cf6', percent: 75 },
    'COMPLETED': { color: '#000000', percent: 100 },
    'CLOSED': { color: '#10b981', percent: 100 },
  };

  const config = configs[status.toUpperCase()] || configs['OPEN'];
  const percentage = config.percent;

  // SVG path for a pie slice
  const calculatePath = (pct: number) => {
    if (pct <= 0) return '';
    if (pct >= 100) return 'M 12 12 m -8, 0 a 8,8 0 1,0 16,0 a 8,8 0 1,0 -16,0';

    const angle = (pct / 100) * 360;
    const radians = ((angle - 90) * Math.PI) / 180;
    const x = 12 + 8 * Math.cos(radians);
    const y = 12 + 8 * Math.sin(radians);
    const largeArcFlag = pct > 50 ? 1 : 0;

    return `M 12 12 L 12 4 A 8 8 0 ${largeArcFlag} 1 ${x} ${y} Z`;
  };

  return (
    <div className="w-9 h-9 flex items-center justify-center shrink-0">
      <div className="relative w-6 h-6 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-full h-full">
          {/* Background circle outline */}
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke={config.color}
            strokeWidth="1.5"
            className="opacity-20"
          />
          {/* Pie sector */}
          <path
            d={calculatePath(percentage)}
            fill={config.color}
            className="transition-all duration-300"
          />
        </svg>
      </div>
    </div>
  );
}

function SenderAvatar({ notif }: { notif: Notification }) {
  if (notif.senderAvatarUrl) {
    return (
      <img
        src={resolveAssetUrl(notif.senderAvatarUrl)}
        alt="sender"
        className="w-7 h-7 rounded-full object-cover shrink-0 shadow-sm"
      />
    );
  }
  return <UserAvatar notif={notif} />;
}

function groupByDate(groups: { latest: Notification; count: number; newCount: number }[]) {
  const dateGroups: Record<string, { latest: Notification; count: number; newCount: number }[]> = {
    'Today': [],
    'Tomorrow': [],
    'Yesterday': [],
    'Last 7 Days': [],
    'Older': []
  };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const last7 = new Date(today); last7.setDate(today.getDate() - 7);

  groups.forEach(g => {
    const d = new Date(g.latest.createdAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (day.getTime() === today.getTime()) dateGroups['Today'].push(g);
    else if (day.getTime() === tomorrow.getTime()) dateGroups['Tomorrow'].push(g);
    else if (day.getTime() === yesterday.getTime()) dateGroups['Yesterday'].push(g);
    else if (day.getTime() >= last7.getTime()) dateGroups['Last 7 Days'].push(g);
    else dateGroups['Older'].push(g);
  });
  return dateGroups;
}

const extractTaskId = (link: string | null | undefined) => {
  if (!link) return null;
  // If backend sent the literal taskId as link, accept it (uuid-ish).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(link)) {
    return link;
  }
  // Support multiple link shapes used across the app:
  // - /tasks/:id
  // - /task/:id
  // - /inbox/task/:id
  // - full URLs containing those paths
  const patterns = [
    /(?:^|\/)(?:tasks|task)\/([^/?#]+)/,
    /(?:^|\/)inbox\/task\/([^/?#]+)/,
    /[?&]taskId=([^&]+)/,
  ];
  for (const p of patterns) {
    const m = link.match(p);
    if (m?.[1]) return decodeURIComponent(m[1]);
  }
  return null;
};

const TASK_SEEN_KEY = 'inbox_task_last_seen';
const MISC_SEEN_KEY = 'inbox_misc_last_seen';
const getTaskSeenMap = () => {
  try {
    return JSON.parse(localStorage.getItem(TASK_SEEN_KEY) || '{}') as Record<string, number>;
  } catch {
    return {} as Record<string, number>;
  }
};
const getMiscSeen = () => parseInt(localStorage.getItem(MISC_SEEN_KEY) || '0', 10) || 0;
const getSeenTsForNotif = (n: Notification) => {
  const tId = extractTaskId(n.link);
  if (tId) return getTaskSeenMap()[tId] || 0;
  return getMiscSeen();
};

const extractTaskNameHint = (n: Notification) => {
  const raw = `${n.title || ''} ${n.message || ''}`.trim();
  if (!raw) return '';
  const patterns = [
    /assigned:\s*(.+)$/i,
    /task\s+updated:\s*(.+)$/i,
    /commented\s+on\s+task:\s*(.+)$/i,
    /task:\s*(.+)$/i,
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m?.[1]) return m[1].trim();
  }
  const parts = raw.split(' - ');
  if (parts.length >= 2) return parts.slice(1).join(' - ').trim();
  return '';
};

export function InboxPage() {
  const [activeTab, setActiveTab] = useState('Primary');
  const { notifications, unreadCount, resetUnreadCount, markTaskSeen, markAllAsRead, markTaskAsRead, loading, refresh } = useNotifications();
  const navigate = useNavigate();
  const { canUpdateTaskStatus } = useOrgRole();
  const [statusByTaskId, setStatusByTaskId] = useState<Record<string, string>>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [sortNewestFirst, setSortNewestFirst] = useState(true);
  const [filterOnlyTasks, setFilterOnlyTasks] = useState(false);
  const [filterOnlyNew, setFilterOnlyNew] = useState(false);
  const [filterRange, setFilterRange] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [filterQuery, setFilterQuery] = useState('');
  const filterRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('inbox_filters_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw) as any;
      if (typeof parsed?.unreadOnly === 'boolean') setFilterUnreadOnly(parsed.unreadOnly);
      if (typeof parsed?.sortNewestFirst === 'boolean') setSortNewestFirst(parsed.sortNewestFirst);
      if (typeof parsed?.onlyTasks === 'boolean') setFilterOnlyTasks(parsed.onlyTasks);
      if (typeof parsed?.onlyNew === 'boolean') setFilterOnlyNew(parsed.onlyNew);
      if (parsed?.range === 'all' || parsed?.range === 'today' || parsed?.range === '7d' || parsed?.range === '30d') setFilterRange(parsed.range);
      if (typeof parsed?.query === 'string') setFilterQuery(parsed.query);
    } catch {
      // ignore
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('inbox_filters_v1', JSON.stringify({
        unreadOnly: filterUnreadOnly,
        sortNewestFirst,
        onlyTasks: filterOnlyTasks,
        onlyNew: filterOnlyNew,
        range: filterRange,
        query: filterQuery,
      }));
    } catch {
      // ignore
    }
  }, [filterUnreadOnly, sortNewestFirst, filterOnlyTasks, filterOnlyNew, filterRange, filterQuery]);

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = filterRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setFilterOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [filterOpen]);


  const filteredNotifications = useMemo(() => {
    switch (activeTab) {
      case 'Cleared':
        return notifications.filter((n: Notification) => n.isRead);
      case 'Primary':
        return notifications.filter((n: Notification) => !n.isRead);
      case 'Other':
        return notifications.filter((n: Notification) => !n.isRead && (!n.link || !n.link.includes('task')));
      default:
        return notifications.filter((n: Notification) => !n.isRead);
    }
  }, [notifications, activeTab]);

  const finalNotifications = useMemo(() => {
    let items = filteredNotifications;
    if (filterUnreadOnly) items = items.filter((n) => !n.isRead);
    if (filterOnlyTasks) items = items.filter((n) => {
      const tId = extractTaskId(n.link);
      if (tId) return true;
      // Fallback: some notifications embed task id in the message text.
      return /\/(?:tasks|task)\/[0-9a-f-]{12,}/i.test(n.message || '');
    });
    if (filterOnlyNew) items = items.filter((n) => {
      const seenTs = getSeenTsForNotif(n);
      return !n.isRead && new Date(n.createdAt).getTime() > seenTs;
    });
    if (filterRange !== 'all') {
      const now = Date.now();
      const start = (() => {
        if (filterRange === 'today') {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          return d.getTime();
        }
        if (filterRange === '7d') return now - 7 * 24 * 60 * 60 * 1000;
        return now - 30 * 24 * 60 * 60 * 1000;
      })();
      items = items.filter((n) => new Date(n.createdAt).getTime() >= start);
    }
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      items = items.filter((n) => {
        const taskHint = extractTaskNameHint(n);
        const hay = `${n.title || ''} ${n.message || ''} ${taskHint} ${n.link || ''} ${(n as any).senderName || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    items = [...items].sort((a, b) => {
      const av = new Date(a.createdAt).getTime();
      const bv = new Date(b.createdAt).getTime();
      return sortNewestFirst ? (bv - av) : (av - bv);
    });
    return items;
  }, [filteredNotifications, filterUnreadOnly, filterOnlyTasks, filterOnlyNew, filterRange, filterQuery, sortNewestFirst]);

  const deduplicatedByTask = useMemo(() => {
    const groups = new Map<string, { latest: Notification; count: number; newCount: number }>();

    finalNotifications.forEach(n => {
      // Keep "unassigned" notices as standalone rows (do not merge into task thread),
      // so clicking that notice can move it to Cleared reliably.
      const isUnassignedNotice = n.message?.toLowerCase().includes('unassigned');
      const groupKey = isUnassignedNotice ? n.id : (extractTaskId(n.link) ?? n.id);
      const group = groups.get(groupKey);
      const seenTs = getSeenTsForNotif(n);
      const isNew = !n.isRead && new Date(n.createdAt).getTime() > seenTs;

      if (!group) {
        groups.set(groupKey, { latest: n, count: 1, newCount: isNew ? 1 : 0 });
      } else {
        group.count += 1;
        if (isNew) group.newCount += 1;
        // Keep the latest one
        if (new Date(n.createdAt) > new Date(group.latest.createdAt)) {
          group.latest = n;
        }
      }
    });
    return Array.from(groups.values()).sort((a, b) => {
      // Keep "new/unseen" threads on top.
      if (a.newCount !== b.newCount) return b.newCount - a.newCount;
      const av = new Date(a.latest.createdAt).getTime();
      const bv = new Date(b.latest.createdAt).getTime();
      return sortNewestFirst ? (bv - av) : (av - bv);
    });
  }, [finalNotifications, sortNewestFirst]);

  const grouped = useMemo(() => groupByDate(deduplicatedByTask), [deduplicatedByTask]);

  // Fetch current task statuses so the group icon always matches real status.
  useEffect(() => {
    const taskIds = deduplicatedByTask
      .map(g => extractTaskId(g.latest.link))
      .filter((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      .slice(0, 200);

    if (taskIds.length === 0) {
      setStatusByTaskId({});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await api.post<{ success: boolean; data: Record<string, string> }>(`/tasks/statuses`, { taskIds });
        if (!cancelled) setStatusByTaskId(res.data.data || {});
      } catch (e) {
        // If this fails we just fallback to message parsing.
      }
    })();

    return () => { cancelled = true; };
  }, [deduplicatedByTask]);

  const handleClick = (notif: Notification) => {
    const taskId = extractTaskId(notif.link);
    // Mark as seen for bell badge only; keep read-state unchanged unless user explicitly clears.
    if (taskId) markTaskSeen(taskId);
    else resetUnreadCount();
    if (taskId) {
      navigate(`/inbox/task/${taskId}`);
    } else if (notif.link) {
      if (notif.link.startsWith('http')) window.open(notif.link, '_blank');
      else navigate(notif.link);
    }
  };

  const NotifRow = ({ group }: { group: { latest: Notification; count: number; newCount: number } }) => {
    const notif = group.latest;
    const taskId = extractTaskId(notif.link);
    const isAssigned = notif.message.toLowerCase().includes('assigned this task') || notif.message.toLowerCase().includes('assigned you');
    const isNew = !notif.isRead && new Date(notif.createdAt).getTime() > getSeenTsForNotif(notif);

    const fullMessage = getCommentSummary(notif.message);
    const firstTwoWords = fullMessage.split(' ').slice(0, 2).join(' ');
    const messageRest = fullMessage.replace(firstTwoWords, '').trim();

    return (
      <div className="relative group/row">
        <div className={`w-full grid grid-cols-[1.5fr_2fr_1fr] items-center gap-4 px-1 border-b border-gray-100 dark:border-gray-800/30 transition-all ${isAssigned ? 'bg-indigo-50/10 dark:bg-indigo-900/5' : 'group-hover/row:bg-gray-50/50 dark:group-hover/row:bg-gray-800/10'}`}>
          {/* Main Content Clickable Area */}
          <button
            onClick={() => handleClick(notif)}
            className="col-span-2 grid grid-cols-[1.5fr_2fr] items-center gap-4 py-3.5 text-left min-w-0"
          >
            <div className="flex items-center gap-4 min-w-0">
              <div className="shrink-0 transition-transform group-hover/row:scale-105">
                {/* 
                   Since status might not be in Notif, we fallback to a default 
                   or check if the message indicates a status change.
                */}
                <StatusIcon
                  status={
                    (taskId && statusByTaskId[taskId])
                      ? statusByTaskId[taskId]
                      : notif.message.includes('Changed status to')
                        ? notif.message.split('to ')[1]?.split(' ')[0]?.toUpperCase()
                        : notif.message.includes('status to')
                          ? notif.message.split('to ')[1]?.split(' ')[0]?.toUpperCase()
                          : 'PENDING'
                  }
                />
              </div>
              <span className={`text-[13px] sm:text-[14px] font-bold text-gray-900 dark:text-gray-100 truncate`}>
                {notif.title}
              </span>
              {isAssigned && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-[9px] font-black text-indigo-600 dark:text-indigo-300 uppercase tracking-wider shrink-0">
                  Assigned
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 flex items-center justify-center shrink-0">
                <SenderAvatar notif={notif} />
              </div>
              <div className="text-[13px] sm:text-[14px] truncate flex items-center gap-1.5 min-w-0">
                <span className="font-bold text-gray-700 dark:text-gray-200 shrink-0">{firstTwoWords}</span>
                <span className="text-indigo-600 dark:text-indigo-400 font-medium truncate">
                  {messageRest}
                </span>
              </div>
            </div>
          </button>

          {/* Right side: Metadata/Actions */}
          <div className="flex items-center justify-end gap-6 shrink-0 relative py-3.5 h-full">
            <div className="flex items-center gap-4 transition-all duration-200 group-hover/row:opacity-0 group-hover/row:translate-x-2">
              {group.newCount > 0 && (
                <div className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-[10px] font-black text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800 animate-pulse">
                  {group.newCount}
                </div>
              )}
              <span className="text-[12px] sm:text-[13px] text-gray-400 font-sans min-w-[50px] text-right pr-2">
                {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(notif.createdAt))}
              </span>
            </div>

            {/* Hover Actions */}
            {canUpdateTaskStatus && (
            <div className="absolute right-0 flex items-center gap-2 opacity-0 translate-x-4 group-hover/row:opacity-100 group-hover/row:translate-x-0 transition-all duration-300 z-10">
              <button
                onClick={(e) => { e.stopPropagation(); markTaskAsRead(notif); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-black uppercase tracking-widest rounded-lg shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all cursor-pointer"
              >
                <Check size={14} strokeWidth={3} />
                Clear
              </button>
            </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const DateGroup = ({ label, items }: { label: string; items: { latest: Notification; count: number; newCount: number }[] }) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-8">
        <h3 className="px-1 mb-4 text-[15px] font-extrabold text-[#5F6D81] dark:text-gray-400 font-sans tracking-tight">
          {label}
        </h3>
        <div className="space-y-0 border-t border-gray-100 dark:border-gray-800/50">
          {items.map(g => <NotifRow key={g.latest.id} group={g} />)}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-white dark:bg-[#0F172A] font-sans">
      <div className="flex justify-center border-b border-gray-100 dark:border-gray-800 shrink-0 bg-white dark:bg-[#0F172A]">
        <div className="w-full max-w-7xl flex items-center px-4 overflow-x-auto scrollbar-none">
          {INBOX_TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  flex flex-col items-start gap-0.5 px-6 py-4 transition-all relative whitespace-nowrap shrink-0 group min-w-[120px]
                  ${isActive
                    ? 'text-gray-900 dark:text-white'
                    : 'text-gray-400 hover:text-gray-700 hover:-translate-y-0.5'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <div className={`${isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400 group-hover:text-indigo-500'} transition-colors duration-300`}>
                    {tab.icon}
                  </div>
                  <span className={`text-[14px] ${isActive ? 'font-bold' : 'font-medium group-hover:font-semibold'} transition-all`}>{tab.label}</span>
                </div>
                {isActive && (
                  <motion.div
                    layoutId="inboxTabUnderline"
                    className={`absolute bottom-0 left-0 right-0 h-[3.5px] bg-indigo-600 dark:bg-indigo-400 rounded-t-full shadow-[0_-2px_6px_rgba(79,70,229,0.3)]`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center bg-white dark:bg-[#0F172A]">
        <div className="w-full max-w-7xl flex items-center justify-between px-6 py-4 shrink-0">
          <div className="relative" ref={filterRef}>
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className="flex items-center gap-2 px-3 py-1.5 text-[12px] font-bold text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 transition-colors bg-gray-50/50 dark:bg-gray-800/40 rounded-lg border border-gray-100 dark:border-gray-800"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter
            </button>

            <AnimatePresence>
              {filterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="absolute left-0 mt-2 w-56 rounded-xl border border-gray-200/70 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-2 z-50"
                >
                  <div className="px-2.5 pt-2 pb-1">
                    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">
                      Search
                    </div>
                    <input
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Search notifications…"
                      className="w-full h-9 rounded-lg px-3 text-[12px] font-bold bg-gray-50 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setFilterUnreadOnly((v) => {
                        const next = !v;
                        if (next) setActiveTab('Primary');
                        return next;
                      });
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <span>Unread only</span>
                    <span className={`w-9 h-5 rounded-full p-[2px] transition-colors ${filterUnreadOnly ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                      <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${filterUnreadOnly ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterOnlyTasks((v) => !v)}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <span>Only tasks</span>
                    <span className={`w-9 h-5 rounded-full p-[2px] transition-colors ${filterOnlyTasks ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                      <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${filterOnlyTasks ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFilterOnlyNew((v) => !v)}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <span>Only new</span>
                    <span className={`w-9 h-5 rounded-full p-[2px] transition-colors ${filterOnlyNew ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}>
                      <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${filterOnlyNew ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                  </button>

                  <div className="px-2.5 pt-1">
                    <div className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1">
                      Date range
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {([
                        ['all', 'All'],
                        ['today', 'Today'],
                        ['7d', '7d'],
                        ['30d', '30d'],
                      ] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setFilterRange(id)}
                          className={`h-7 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                            filterRange === id
                              ? 'bg-indigo-600 text-white'
                              : 'bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSortNewestFirst((v) => !v)}
                    className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-[12px] font-bold text-gray-700 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors"
                  >
                    <span>Sort</span>
                    <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                      {sortNewestFirst ? 'Newest' : 'Oldest'}
                    </span>
                  </button>

                  <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" />

                  <button
                    type="button"
                    onClick={() => {
                      setFilterUnreadOnly(false);
                      setSortNewestFirst(true);
                      setFilterOnlyTasks(false);
                      setFilterOnlyNew(false);
                      setFilterRange('all');
                      setFilterQuery('');
                      setFilterOpen(false);
                    }}
                    className="w-full px-2.5 py-2 rounded-lg text-[12px] font-black text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors text-left"
                  >
                    Reset
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              title="Settings"
            >
              <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {activeTab === 'Primary' && canUpdateTaskStatus && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-50/50 dark:bg-gray-800/40 hover:bg-gray-100 dark:hover:bg-gray-700 text-[12px] font-bold text-gray-600 dark:text-gray-300 rounded-lg border border-gray-100 dark:border-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700 bg-white dark:bg-[#0F172A]">
        <>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <svg className="animate-spin w-8 h-8 text-indigo-500" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" fill="currentColor" className="opacity-75" />
              </svg>
            </div>
          ) : deduplicatedByTask.length === 0 ? (
            <div className="flex items-center justify-center min-h-[400px]">
              <EmptyNotifications />
            </div>
          ) : (
            <div className="w-full max-w-7xl mx-auto px-4 md:px-6 py-6">
              <div className="space-y-6">
                <DateGroup label="Today" items={grouped['Today']} />
                <DateGroup label="Tomorrow" items={grouped['Tomorrow']} />
                <DateGroup label="Yesterday" items={grouped['Yesterday']} />
                <DateGroup label="Last 7 days" items={grouped['Last 7 Days']} />
                <DateGroup label="Older" items={grouped['Older']} />
              </div>
            </div>
          )}
        </>
      </div>
    </div>
  );
}
