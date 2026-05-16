import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, Sector } from 'recharts';

// Recharts v3: Pie supports activeIndex/activeShape at runtime; published TS types omit them.
type PieWithActiveProps = React.ComponentProps<typeof Pie> & {
  activeIndex?: number;
  activeShape?: (props: any) => React.ReactNode;
};
const PieWithActive = Pie as unknown as React.FC<PieWithActiveProps>;

function StableChartFrame({
  className,
  minWidth = 260,
  minHeight = 280,
  children,
}: {
  className?: string;
  minWidth?: number;
  minHeight?: number;
  children: (size: { width: number; height: number }) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf = 0;
    const update = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        if (width > 0 && height > 0) {
          setSize({ width: Math.max(width, minWidth), height: Math.max(height, minHeight) });
        }
      });
    };

    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [minWidth, minHeight]);

  return <div ref={ref} className={className}>{size ? children(size) : null}</div>;
}

/* ── Scroll-triggered animation wrapper ── */
function ScrollReveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 1.5, delay, ease: [0.25, 0.1, 0.25, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
import api from '../../services/api';
import { batchRequests } from '../../services/requestManager';
import { useAppSelector, useAppDispatch } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { useNotifications } from '../../hooks/useNotifications';
import { useOrgRole } from '../../hooks/useOrgRole';
import { fetchUnreadCounts, incrementUnread, resetUnread } from '../../store/slices/messageSlice';
import type { DashboardStats, Task } from '../../types';
import { ChartDetailModal } from '../../components/dashboard/ChartDetailModal';

/* ── Custom Widgets & Sub-components ── */

const WEATHER_CODES: Record<number, { label: string; icon: string }> = {
  0: { label: 'Clear sky', icon: '☀️' },
  1: { label: 'Mainly clear', icon: '🌤️' },
  2: { label: 'Partly cloudy', icon: '⛅' },
  3: { label: 'Overcast', icon: '☁️' },
  45: { label: 'Foggy', icon: '🌫️' },
  48: { label: 'Icy fog', icon: '🌫️' },
  51: { label: 'Light drizzle', icon: '🌦️' },
  53: { label: 'Drizzle', icon: '🌦️' },
  55: { label: 'Heavy drizzle', icon: '🌧️' },
  61: { label: 'Light rain', icon: '🌦️' },
  63: { label: 'Rain', icon: '🌧️' },
  65: { label: 'Heavy rain', icon: '🌧️' },
  71: { label: 'Light snow', icon: '🌨️' },
  73: { label: 'Snow', icon: '❄️' },
  75: { label: 'Heavy snow', icon: '❄️' },
  80: { label: 'Rain showers', icon: '🌦️' },
  81: { label: 'Rain showers', icon: '🌧️' },
  82: { label: 'Heavy showers', icon: '⛈️' },
  95: { label: 'Thunderstorm', icon: '⛈️' },
  96: { label: 'Hail storm', icon: '⛈️' },
  99: { label: 'Heavy hail', icon: '⛈️' },
};

function useWeather() {
  const [weather, setWeather] = useState<{ temp: number; code: number; city: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Check sessionStorage cache first (avoid repeated API calls)
    const cached = sessionStorage.getItem('weather_cache');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Date.now() - parsed.ts < 30 * 60 * 1000) { // 30 min cache
          setWeather(parsed.data);
          return;
        }
      } catch { /* ignore */ }
    }

    (async () => {
      try {
        // Use ip-api.com (free, CORS-enabled, no key needed) - HTTPS for production
        const geoRes = await fetch('https://ip-api.com/json/?fields=city,lat,lon');
        if (!geoRes.ok) return;
        const geo = await geoRes.json();
        const lat = geo.lat;
        const lon = geo.lon;
        const city = geo.city || '';
        if (!lat || !lon) return;

        const weatherRes = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`
        );
        if (!weatherRes.ok) return;
        const data = await weatherRes.json();
        if (!cancelled && data.current_weather) {
          const result = { temp: Math.round(data.current_weather.temperature), code: data.current_weather.weathercode, city };
          setWeather(result);
          sessionStorage.setItem('weather_cache', JSON.stringify({ data: result, ts: Date.now() }));
        }
      } catch {
        // Silently fail — weather is non-critical
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return weather;
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(val >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function PrettyTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0];
  const name = p?.name || label || p?.payload?.name || 'Value';
  const value = p?.value ?? p?.payload?.value ?? 0;
  return (
    <div className="rounded-xl border border-gray-200/70 dark:border-gray-700/60 bg-white/95 dark:bg-gray-900/95 backdrop-blur px-3 py-2 shadow-xl">
      <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 dark:text-gray-400">{String(name)}</div>
      <div className="mt-0.5 text-[14px] font-black text-gray-900 dark:text-white tabular-nums">{value}</div>
    </div>
  );
}

function GreetingSection({
  name,
  isAdminLike,
  storageUsedBytes,
  attachmentCount,
  totalStorageUsedBytes,
  totalAttachmentCount,
  openTaskCount,
  unassignedOpenTaskCount,
  memberCount,
  onlineMembers,
}: {
  name: string;
  isAdminLike?: boolean;
  storageUsedBytes?: number;
  attachmentCount?: number;
  totalStorageUsedBytes?: number;
  totalAttachmentCount?: number;
  openTaskCount?: number;
  unassignedOpenTaskCount?: number;
  memberCount?: number;
  onlineMembers?: Array<{ id: string; name: string; avatarUrl: string | null }>;
}) {
  const hour = new Date().getHours();
  let greetingText = 'Good evening';
  if (hour < 12) { greetingText = 'Good morning'; }
  else if (hour < 17) { greetingText = 'Good afternoon'; }

  const weather = useWeather();
  const weatherInfo = weather ? WEATHER_CODES[weather.code] || { label: 'Weather', icon: '🌡️' } : null;
  const [activeOnlineIdx, setActiveOnlineIdx] = useState(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!onlineMembers || onlineMembers.length <= 1) return;
    const id = window.setInterval(() => {
      setActiveOnlineIdx((prev) => (prev + 1) % onlineMembers.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [onlineMembers?.length]);

  const activeOnline = onlineMembers && onlineMembers.length > 0
    ? onlineMembers[Math.min(activeOnlineIdx, onlineMembers.length - 1)]
    : null;

  const now = new Date(nowTs);
  const lunchStart = new Date(now); lunchStart.setHours(13, 0, 0, 0);
  const lunchEnd = new Date(now); lunchEnd.setHours(14, 0, 0, 0);
  const stopTime = new Date(now); stopTime.setHours(19, 0, 0, 0);
  const isLunchTime = now >= lunchStart && now < lunchEnd;
  const isAfterLunch = now >= lunchEnd;
  const isAfterStop = now >= stopTime;

  const time24 = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  const [hh, mm, ss] = time24.split(':');

  const clock12Parts = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(now);
  const clock12Hour = clock12Parts.find((p) => p.type === 'hour')?.value || '00';
  const clock12Minute = clock12Parts.find((p) => p.type === 'minute')?.value || '00';
  const clock12DayPeriod = (clock12Parts.find((p) => p.type === 'dayPeriod')?.value || '').toUpperCase();

  const [insightsUpdatedTs, setInsightsUpdatedTs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isAdminLike) return;
    setInsightsUpdatedTs(Date.now());
  }, [isAdminLike, storageUsedBytes, attachmentCount, totalStorageUsedBytes, totalAttachmentCount, openTaskCount, unassignedOpenTaskCount]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, ease: [0.25, 0.1, 0.25, 1] }}
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-purple-800 p-5 sm:p-6 text-white shadow-2xl"
    >
      <div className="relative z-10 flex flex-col 2xl:flex-row 2xl:items-start 2xl:justify-between gap-4 min-w-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl lg:text-2xl xl:text-3xl font-extrabold tracking-tight mb-2">
            {greetingText}, <span className="text-indigo-200">{name}</span>!
          </h1>
          <p className="text-indigo-100/80 max-w-lg text-sm md:text-base font-medium leading-relaxed">
            Welcome back to your workspace. Everything is updated in real-time.
          </p>
          <div className="mt-5 sm:mt-8 flex flex-wrap gap-2 sm:gap-3">
            <Link to="/tasks/assigned" className="bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/20 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-sm font-bold transition-all flex items-center gap-2">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              My Open Tasks
            </Link>
            <Link to="/inbox" className="bg-indigo-500/30 hover:bg-indigo-500/40 backdrop-blur-md border border-white/10 px-3 sm:px-4 py-2 rounded-xl text-[10px] sm:text-sm font-bold transition-all flex items-center gap-2">
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              Review Inbox
            </Link>
          </div>
        </div>

        {/* People progress + Active person ticker (Owner/Admin only) */}
        {isAdminLike && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
            className="hidden xl:flex flex-col gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-3 min-w-[260px] self-start"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200">People progress</span>
              <span className="text-[9px] font-bold text-indigo-200/70">Live</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Online</div>
                <div className="text-[14px] font-black leading-tight mt-1 tabular-nums">{onlineMembers?.length ?? 0}</div>
              </div>
              <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Members</div>
                <div className="text-[14px] font-black leading-tight mt-1 tabular-nums">{memberCount ?? 0}</div>
              </div>
              <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Online %</div>
                <div className="text-[14px] font-black leading-tight mt-1 tabular-nums">
                  {memberCount && memberCount > 0 ? `${Math.round(((onlineMembers?.length ?? 0) / memberCount) * 100)}%` : '0%'}
                </div>
              </div>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/10">
              <div
                className="h-full bg-emerald-400/80"
                style={{ width: `${memberCount && memberCount > 0 ? Math.min(100, Math.round(((onlineMembers?.length ?? 0) / memberCount) * 100)) : 0}%` }}
              />
            </div>

            {/* Active person ticker (slides left->right every 5s) */}
            <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 overflow-hidden group">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Active person</span>
                <span className="text-[9px] font-bold text-indigo-200/70 tabular-nums">
                  {onlineMembers?.length ? `${activeOnlineIdx + 1}/${onlineMembers.length}` : '0/0'}
                </span>
              </div>
              <div className="relative h-9">
                <AnimatePresence mode="wait">
                  {activeOnline ? (
                    <motion.div
                      key={activeOnline.id}
                      initial={{ opacity: 0, x: -24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 24 }}
                      transition={{ duration: 0.35, ease: 'easeOut' }}
                      className="absolute inset-0 flex items-center gap-2 rounded-lg px-2 hover:bg-white/10 transition-colors"
                      title="Rotates every 5 seconds"
                    >
                      <div className="w-7 h-7 rounded-full overflow-hidden border border-white/20 bg-white/10 flex items-center justify-center text-[11px] font-black shrink-0">
                        {activeOnline.avatarUrl ? (
                          <img src={activeOnline.avatarUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span>{activeOnline.name?.trim()?.charAt(0)?.toUpperCase()}</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-black text-indigo-50 truncate max-w-[260px]">{activeOnline.name}</div>
                        <div className="text-[9px] font-bold text-emerald-200/90 uppercase tracking-widest">online</div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex items-center text-[11px] font-bold text-indigo-100/70"
                    >
                      No one online
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}

        <div className="mt-2 2xl:mt-0 flex flex-col 2xl:flex-row flex-wrap items-stretch gap-3 w-full min-w-0 2xl:w-auto 2xl:flex-wrap 2xl:items-start 2xl:justify-end 2xl:self-start">
          {/* Owner/Admin future panel */}
          {isAdminLike && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="flex flex-col gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-3 py-3 sm:px-4 w-full min-w-0 sm:min-w-[160px] sm:w-auto sm:max-w-[min(100%,260px)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-200">Workspace insights</span>
                <span className="text-[9px] font-bold text-indigo-200/70 tabular-nums">
                  {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(insightsUpdatedTs))}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                  <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">
                    {typeof totalStorageUsedBytes === 'number' ? 'Total storage' : 'Storage'}
                  </div>
                  <motion.div
                    key={`storage-${typeof totalStorageUsedBytes === 'number' ? totalStorageUsedBytes : (storageUsedBytes ?? 0)}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="text-[14px] font-black leading-tight mt-1"
                  >
                    {formatBytes((typeof totalStorageUsedBytes === 'number' ? totalStorageUsedBytes : storageUsedBytes) || 0)}
                  </motion.div>

                  {typeof totalStorageUsedBytes === 'number' && typeof storageUsedBytes === 'number' && totalStorageUsedBytes > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[9px] font-bold text-indigo-100/75">
                        <span className="uppercase tracking-widest">Workspace</span>
                        <span className="tabular-nums">{formatBytes(storageUsedBytes || 0)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden border border-white/10">
                        <div
                          className="h-full rounded-full bg-emerald-300/80"
                          style={{ width: `${Math.max(0, Math.min(100, (storageUsedBytes / totalStorageUsedBytes) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                  <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">
                    {typeof totalAttachmentCount === 'number' ? 'Total attachments' : 'Attachments'}
                  </div>
                  <motion.div
                    key={`attachments-${typeof totalAttachmentCount === 'number' ? totalAttachmentCount : (attachmentCount ?? 0)}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="text-[14px] font-black leading-tight mt-1 tabular-nums"
                  >
                    {typeof totalAttachmentCount === 'number' ? totalAttachmentCount : (attachmentCount ?? 0)}
                  </motion.div>
                </div>
                <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                  <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Open tasks</div>
                  <motion.div
                    key={`open-${openTaskCount ?? 0}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="text-[14px] font-black leading-tight mt-1 tabular-nums"
                  >
                    {openTaskCount ?? 0}
                  </motion.div>
                </div>
                <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2">
                  <div className="text-[9px] font-black uppercase tracking-widest text-indigo-200/80">Unassigned</div>
                  <motion.div
                    key={`unassigned-${unassignedOpenTaskCount ?? 0}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="text-[14px] font-black leading-tight mt-1 tabular-nums"
                  >
                    {unassignedOpenTaskCount ?? 0}
                  </motion.div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Right column: Weather + Time box (stacked) */}
          <div className="flex flex-col gap-3 w-full min-w-0 sm:w-auto shrink-0 self-stretch sm:self-start">
            {/* Weather Widget */}
            {weather && weatherInfo && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, duration: 0.6 }}
                className="flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-4 py-3"
              >
                <span className="text-3xl sm:text-4xl">{weatherInfo.icon}</span>
                <div className="flex flex-col">
                  <span className="text-2xl sm:text-3xl font-black leading-none">{weather.temp}°C</span>
                  <span className="text-[11px] sm:text-xs font-semibold text-indigo-200 mt-0.5">{weatherInfo.label}</span>
                  {weather.city && <span className="text-[10px] sm:text-[11px] font-medium text-indigo-300/70">{weather.city}</span>}
                </div>
              </motion.div>
            )}

            {/* Lunch/Stop time widget */}
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.55, duration: 0.6 }}
              className="flex flex-col gap-2 w-full min-w-0 sm:min-w-[140px] sm:w-auto shrink-0"
            >
              {isLunchTime ? (
                <>
                  <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a1a1a] to-[#050505] shadow-[0_10px_25px_rgba(0,0,0,0.25)]">
                    <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.35),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.22),transparent_50%)]" />
                    <div className="absolute inset-x-0 top-[38%] h-[1px] bg-white/12" />
                    <div className="absolute inset-x-0 top-[58%] h-[1px] bg-white/10" />

                    <div className="relative px-4 py-3">
                      <div className="text-center text-[11px] font-semibold tracking-[0.18em] text-white/85 uppercase">
                        {(weather?.city || 'LONDON').toString().toUpperCase()}
                      </div>

                      <div className="mt-2 flex items-end justify-center gap-2">
                        <div className="font-black leading-none text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] text-[44px] tabular-nums">
                          {clock12Hour}:{clock12Minute}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[12px] font-semibold tracking-[0.12em] text-white/55">
                        <span className="uppercase">TODAY</span>
                        <span className="uppercase">{clock12DayPeriod || 'PM'}</span>
                      </div>

                      <div className="mt-2 flex items-center justify-center">
                        <div className="inline-flex items-center justify-center rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 text-[11px] font-black text-white/85 tabular-nums">
                          1:00 PM to 2:00 PM
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a1a1a] to-[#050505] shadow-[0_10px_25px_rgba(0,0,0,0.25)]">
                    <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.35),transparent_45%),radial-gradient(circle_at_80%_30%,rgba(255,255,255,0.22),transparent_50%)]" />
                    <div className="absolute inset-x-0 top-[38%] h-[1px] bg-white/12" />
                    <div className="absolute inset-x-0 top-[58%] h-[1px] bg-white/10" />

                    <div className="relative px-4 py-3">
                      <div className="text-center text-[11px] font-semibold tracking-[0.18em] text-white/85 uppercase">
                        {(weather?.city || 'LONDON').toString().toUpperCase()}
                      </div>

                      <div className="mt-2 flex items-end justify-center gap-2">
                        <div className="font-black leading-none text-white drop-shadow-[0_2px_0_rgba(0,0,0,0.6)] text-[44px] tabular-nums">
                          {clock12Hour}:{clock12Minute}
                        </div>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-[12px] font-semibold tracking-[0.12em] text-white/55">
                        <span className="uppercase">TODAY</span>
                        <span className="uppercase">{clock12DayPeriod || 'PM'}</span>
                      </div>

                      {/* Removed bottom 7:00 PM box (per request) */}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          </div>

          {/* Active person shown inside People progress panel (above). */}
        </div>
      </div>
      <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white/10 rounded-full blur-3xl" />
      <div className="absolute bottom-[-20%] left-[-10%] w-48 h-48 bg-purple-400/20 rounded-full blur-2xl" />
    </motion.div>
  );
}

function TagBadge({ color, name }: { color: string; name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.backgroundColor = color || '#3b82f6';
  }, [color]);
  return (
    <span
      ref={ref}
      className="px-1.5 py-0.5 rounded-[4px] text-[8px] font-black text-white shadow-sm shrink-0 whitespace-nowrap uppercase tracking-tighter"
    >
      {name}
    </span>
  );
}

function ScrollingActivityTicker({ notifications }: { notifications: any[] }) {
  if (notifications.length === 0) return null;

  return (
    <div className="relative w-full overflow-hidden bg-white/50 dark:bg-gray-800/40 backdrop-blur-sm border border-gray-200 dark:border-gray-700/50 rounded-xl h-10 flex items-center group">
      <div className="flex whitespace-nowrap animate-marquee group-hover:pause-animation">
        {[...notifications, ...notifications].map((n, i) => (
          <div key={`${n.id}-${i}`} className="inline-flex items-center gap-3 px-8 border-r border-gray-200 dark:border-gray-700 last:border-r-0">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-xs font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">{n.title}</span>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate max-w-[240px]">{n.message}</span>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          display: inline-flex;
          animation: marquee 45s linear infinite;
        }
        .group:hover .animate-marquee {
          animation-play-state: paused;
        }
      `}</style>
    </div>
  );
}

function DueTasksTicker({ tasks, onTaskClick }: { tasks: Task[]; onTaskClick: (t: Task) => void }) {
  if (tasks.length === 0) return null;

  const formatDueDate = (d: string | null) => {
    if (!d) return '';
    const due = new Date(d);
    const now = new Date();
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dateStr = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (diffDays < 0) return `${dateStr} (${Math.abs(diffDays)}d overdue)`;
    if (diffDays === 0) return `${dateStr} (Today)`;
    return `${dateStr} (in ${diffDays}d)`;
  };

  return (
    <div className="relative w-full overflow-hidden bg-gradient-to-r from-red-50/80 via-orange-50/60 to-red-50/80 dark:from-red-950/20 dark:via-orange-950/10 dark:to-red-950/20 backdrop-blur-sm border border-red-200/60 dark:border-red-800/30 rounded-xl h-11 flex items-center group">
      <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-red-50 dark:from-red-950/40 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-red-50 dark:from-red-950/40 to-transparent z-10 pointer-events-none" />
      <div className="flex whitespace-nowrap animate-due-ticker group-hover:[animation-play-state:paused]">
        {[...tasks, ...tasks].map((task, i) => {
          const isOverdue = task.dueDate ? new Date(task.dueDate) < new Date() : false;
          return (
            <div
              key={`${task.id}-${i}`}
              onClick={() => onTaskClick(task)}
              className="inline-flex items-center gap-2.5 px-6 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <svg className={`w-4 h-4 shrink-0 ${isOverdue ? 'text-red-500' : 'text-orange-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className={`text-xs font-extrabold uppercase tracking-wider shrink-0 ${isOverdue ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400'}`}>
                {formatDueDate(task.dueDate)}
              </span>
              {(task as any).tags?.length > 0 && (
                <span className="inline-flex gap-1">
                  {(task as any).tags.slice(0, 2).map((tag: any) => {
                    const tagStyle = { backgroundColor: tag.color || '#6366f1' } as React.CSSProperties;
                    return (
                      <span key={tag.id} className="px-2 py-0.5 rounded text-[10px] font-black text-white uppercase tracking-tight" {...({ style: tagStyle })}>
                        {tag.name}
                      </span>
                    );
                  })}
                </span>
              )}
              <span className="text-xs font-bold text-gray-700 dark:text-gray-300 max-w-[220px] truncate">
                {task.title}
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0 mx-3" />
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes dueTickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-due-ticker {
          display: inline-flex;
          animation: dueTickerScroll ${Math.max(tasks.length * 6, 20)}s linear infinite;
        }
      `}</style>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  link,
  colorClass,
  delay = 0,
  avatars = [],
  hoverItems = [],
  hoverTitle,
  tickerLabel,
  tickerValue,
  tickerAvatarUrl,
  tickerInitial,
  onTickerClick,
  onHoverItemClick,
}: any) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay, duration: 0.7, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <Link to={link} className="group relative bg-white dark:bg-gray-800/80 rounded-2xl p-4 sm:p-5 border border-gray-100 dark:border-gray-700/50 shadow-sm hover:shadow-xl transition-all flex flex-col min-w-0">
        <div className="flex items-center gap-3 sm:gap-4 mb-4">
          <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 shadow-sm shrink-0 ${colorClass}`}>
            {React.isValidElement(icon) ? React.cloneElement(icon as React.ReactElement<any>, {
              className: `w-5 h-5 sm:w-6 sm:h-6 ${(icon as any).props?.className || ''}`
            }) : icon}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] sm:text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest truncate">{label}</p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white mt-0.5">{value}</h3>
              <span className="flex h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full bg-indigo-500 animate-pulse shrink-0" />
            </div>
          </div>
        </div>
        <div className="mt-2 pt-3 border-t border-gray-50 dark:border-gray-700/30 flex items-center justify-between">
          <div className="min-w-0 flex-1">
            {tickerValue ? (
              <div className="min-w-0">
                {tickerLabel && (
                  <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 truncate">
                    {tickerLabel}
                  </p>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    if (!onTickerClick) return;
                    e.preventDefault();
                    e.stopPropagation();
                    onTickerClick();
                  }}
                  className="w-full text-left flex items-center gap-2 text-[11px] font-bold text-gray-800 dark:text-gray-100 truncate hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  title={tickerValue}
                >
                  {(tickerAvatarUrl || tickerInitial) ? (
                    <span className="w-5 h-5 rounded-full overflow-hidden shrink-0 border border-gray-200/70 dark:border-gray-700/70 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      {tickerAvatarUrl ? (
                        <img
                          src={tickerAvatarUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            // If image fails, hide it so initial becomes visible
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                      {!tickerAvatarUrl && tickerInitial ? (
                        <span className="text-[9px] font-black text-gray-700 dark:text-gray-200">
                          {String(tickerInitial).slice(0, 2).toUpperCase()}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <span className="truncate">{tickerValue}</span>
                </button>
              </div>
            ) : (
              <div className="flex -space-x-1.5">
                {avatars.length > 0 ? (
                  avatars.slice(0, 4).map((m: any, i: number) => (
                    <div key={m.id || i} title={m.name} className="w-6 h-6 rounded-full border-2 border-white dark:border-gray-800 bg-indigo-500 dark:bg-indigo-900 overflow-hidden shrink-0 flex items-center justify-center text-[9px] font-bold text-white shadow-sm">
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[8px]">{m.name?.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  ))
                ) : (
                  [1, 2, 3].map(i => (
                    <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-gray-800 bg-gray-100 dark:bg-gray-700 overflow-hidden shrink-0" />
                  ))
                )}
              </div>
            )}
          </div>
          <div className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            Browse
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </div>

        {Array.isArray(hoverItems) && hoverItems.length > 0 && (
          <div className="pointer-events-none absolute left-4 right-4 top-[92%] z-20 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
            <div className="pointer-events-auto rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md shadow-xl p-3">
              <p className="text-[9px] font-black uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                {hoverTitle || 'Items'} ({hoverItems.length})
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-gray-700">
                {hoverItems.map((t: any) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={(e) => {
                      if (!onHoverItemClick) return;
                      e.preventDefault();
                      e.stopPropagation();
                      onHoverItemClick(t);
                    }}
                    className="w-full flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    title={t.title || t.name || 'Untitled'}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                    {t.avatarUrl ? (
                      <span className="w-5 h-5 rounded-full overflow-hidden shrink-0 border border-gray-200/70 dark:border-gray-700/70 bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                        <img
                          src={t.avatarUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      </span>
                    ) : null}
                    <span className="text-[11px] font-bold text-gray-800 dark:text-gray-100 truncate">
                      {t.title || t.name || 'Untitled'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </Link>
    </motion.div>
  );
}

function InboxFeed({ notifications, markTaskAsRead }: { notifications: any[], markTaskAsRead: (n: any) => void }) {
  const navigate = useNavigate();
  const location = useLocation();

  const extractTaskId = (link: string | null | undefined) => {
    if (!link) return null;
    const match = link.match(/\/(?:tasks|inbox\/task)\/([^/?#]+)/);
    return match ? match[1] : null;
  };

  const handleNotifClick = (n: any) => {
    const taskId = extractTaskId(n.link);
    if (taskId) navigate(`/tasks/${taskId}`, { state: { backgroundLocation: location } });
    else if (n.link) navigate(n.link);
  };

  const getRelativeTime = (date: string) => {
    const now = new Date();
    const then = new Date(date);
    const diff = now.getTime() - then.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const sorted = [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-3">
      {sorted.slice(0, 10).map((n, idx) => (
        <motion.div
          key={n.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: idx * 0.08, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className={`group relative flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-2xl border transition-all ${idx === 0
            ? 'bg-gradient-to-r from-indigo-50/80 via-white to-white dark:from-indigo-950/30 dark:via-gray-800/40 dark:to-gray-800/40 border-indigo-200/70 dark:border-indigo-700/40 shadow-lg shadow-indigo-500/5'
            : !n.isRead ? 'bg-white dark:bg-gray-800/40 border-gray-100 dark:border-gray-700/40 shadow-sm' : 'bg-gray-50/30 dark:bg-gray-800/10 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/30'
            }`}
        >
          <div className="relative shrink-0">
            {n.senderAvatarUrl ? (
              <img
                src={n.senderAvatarUrl}
                className="w-9 h-9 sm:w-11 sm:h-11 rounded-full object-cover shadow-sm ring-2 ring-white dark:ring-gray-800"
                alt=""
                onError={(e) => (e.currentTarget.style.display = 'none')}
              />
            ) : (
              <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-black text-xs sm:text-sm uppercase shadow-sm ring-2 ring-white dark:ring-gray-800">
                {n.title.charAt(0)}
              </div>
            )}
            {!n.isRead && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-indigo-500 rounded-full border-2 border-white dark:border-gray-900 shadow-sm" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[12px] sm:text-[13px] tracking-tight truncate ${!n.isRead ? 'font-black text-gray-900 dark:text-white' : 'font-bold text-gray-500 dark:text-gray-400'}`}>{n.title}</span>
                {idx === 0 && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-500 text-[7px] font-black text-white uppercase tracking-wider leading-none">
                    New
                  </span>
                )}
              </div>
              <span className="text-[9px] sm:text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-tight shrink-0">
                {getRelativeTime(n.createdAt)}
              </span>
            </div>
            <p className={`text-[12px] sm:text-[13px] line-clamp-1 mb-2 ${!n.isRead ? 'font-medium text-gray-600 dark:text-gray-300' : 'font-normal text-gray-400 dark:text-gray-500'}`}>{n.message}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleNotifClick(n)}
                className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-[10px] sm:text-[11px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-600 hover:text-white dark:text-indigo-400 dark:hover:bg-indigo-500 dark:hover:text-white transition-all active:scale-95"
              >
                View
              </button>
              {!n.isRead && (
                <>
                  <span className="w-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700 mx-0.5 sm:mx-1" />
                  <button
                    onClick={(e) => { e.stopPropagation(); markTaskAsRead(n); }}
                    className="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-gray-50 dark:bg-gray-800/40 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-all hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>
        </motion.div>
      ))}
      {notifications.length === 0 && (
        <div className="text-center py-16 bg-gray-50/50 dark:bg-gray-700/20 rounded-3xl border-2 border-dashed border-gray-100 dark:border-gray-700">
          <p className="text-gray-400 font-bold uppercase tracking-widest text-[10px]">Your feed is quiet. Check back later!</p>
        </div>
      )}
    </div>
  );
}

/* ── Scrolling Due Tasks Marquee (for Admin/Super Admin/Owner) ── */
function DueTasksMarquee({ tasks, onTaskClick }: { tasks: Task[], onTaskClick: (t: Task) => void }) {
  if (tasks.length === 0) return (
    <div className="text-center py-8 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-2xl border border-dashed border-emerald-200 dark:border-emerald-800">
      <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest text-[10px]">No due or overdue tasks</p>
    </div>
  );

  const getDueLabel = (dueDate: string | null) => {
    if (!dueDate) return '';
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return 'Due today';
    return `Due in ${diffDays}d`;
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-red-50 via-orange-50 to-amber-50 dark:from-red-950/20 dark:via-orange-950/20 dark:to-amber-950/20 border border-red-100 dark:border-red-900/30">
      <div className="flex flex-col divide-y divide-red-100 dark:divide-red-900/30 max-h-[360px] overflow-y-auto custom-scrollbar">
        {tasks.map((task, idx) => {
          const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
          return (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05, duration: 0.4 }}
              onClick={() => onTaskClick(task)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-white/60 dark:hover:bg-gray-800/30 cursor-pointer transition-all group"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${isOverdue ? 'bg-red-500 animate-pulse' : 'bg-orange-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] sm:text-[13px] font-bold text-gray-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                  {task.title}
                </p>
                <div className="flex items-center gap-2 mt-0.5">
                  {task.assignees?.length > 0 && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {task.assignees.map(a => a.firstName).join(', ')}
                    </span>
                  )}
                  {task.list?.space?.name && (
                    <>
                      <span className="w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{task.list.space.name}</span>
                    </>
                  )}
                </div>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${isOverdue
                ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
                }`}>
                {getDueLabel(task.dueDate)}
              </span>
            </motion.div>
          );
        })}
      </div>
      <style>{`
        @keyframes scrollUp {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
      `}</style>
    </div>
  );
}

/* ── Personal Due Tasks List (for Member/Limited Member/Guest) ── */
function PersonalDueTasksList({ tasks, onTaskClick }: { tasks: Task[], onTaskClick: (t: Task) => void }) {
  if (tasks.length === 0) return (
    <div className="text-center py-8 bg-emerald-50/50 dark:bg-emerald-900/10 rounded-2xl border border-dashed border-emerald-200 dark:border-emerald-800">
      <p className="text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-widest text-[10px]">No due tasks assigned to you</p>
    </div>
  );

  const getDueLabel = (dueDate: string | null) => {
    if (!dueDate) return '';
    const now = new Date();
    const due = new Date(dueDate);
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return 'Due today';
    return `Due in ${diffDays}d`;
  };

  return (
    <div className="space-y-2 max-h-[360px] overflow-y-auto custom-scrollbar">
      {tasks.map((task, idx) => {
        const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
        return (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -15 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.06, duration: 0.5 }}
            onClick={() => onTaskClick(task)}
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:shadow-md ${isOverdue
              ? 'bg-red-50/80 dark:bg-red-950/20 border-red-200 dark:border-red-800/40'
              : 'bg-white dark:bg-gray-800/40 border-gray-100 dark:border-gray-700/40'
              }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isOverdue ? 'bg-red-100 dark:bg-red-900/30' : 'bg-orange-100 dark:bg-orange-900/30'
              }`}>
              <svg className={`w-4 h-4 ${isOverdue ? 'text-red-500' : 'text-orange-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] sm:text-[13px] font-bold text-gray-900 dark:text-white truncate">{task.title}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {task.list?.space?.name && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{task.list.space.name}</span>
                )}
                {task.project?.name && (
                  <>
                    <span className="w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">{task.project.name}</span>
                  </>
                )}
              </div>
            </div>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${isOverdue
              ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
              : 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400'
              }`}>
              {getDueLabel(task.dueDate)}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}

// Keep chart colors stable per-status (not by array index).
const STATUS_COLOR_MAP: Record<string, string> = {
  OPEN: '#94a3b8',
  PENDING: '#f59e0b',
  IN_PROGRESS: '#ec4899',
  IN_REVIEW: '#f97316',
  ACCEPTED: '#ef4444',
  REJECTED: '#8b5cf6',
  COMPLETED: '#111827',
  CLOSED: '#10b981',
};

function normalizeStatusKey(name: unknown) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
}

function statusColor(name: unknown) {
  const key = normalizeStatusKey(name);
  return STATUS_COLOR_MAP[key] || '#64748b';
}

const ASSIGNEE_COLORS = [
  '#3b82f6', '#1e1e1e', '#f97316', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4',
  '#f59e0b', '#ef4444', '#14b8a6', '#6366f1', '#d946ef', '#84cc16', '#0ea5e9',
  '#f43f5e', '#a855f7', '#22c55e', '#eab308', '#64748b', '#be185d',
];

export function DashboardPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [dueTasks, setDueTasks] = useState<Task[]>([]);
  const [isAdminLevel, setIsAdminLevel] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'feed' | 'due'>('feed');
  const [chartData, setChartData] = useState<{ workloadByStatus: any[]; totalTasksByAssignee: any[]; openTasksByAssignee: any[] } | null>(null);
  const [chartModal, setChartModal] = useState<{
    open: boolean;
    chartType: 'workloadByStatus' | 'totalTasksByAssignee' | 'openTasksByAssignee';
    chartTitle: string;
    chartData: any[];
    selectedSegment: string | null;
  }>({ open: false, chartType: 'workloadByStatus', chartTitle: '', chartData: [], selectedSegment: null });
  const [mounted, setMounted] = useState(false);
  const [unassignedTickerIdx, setUnassignedTickerIdx] = useState(0);
  const [assignedTickerIdx, setAssignedTickerIdx] = useState(0);
  const [dueTickerIdx, setDueTickerIdx] = useState(0);
  const [memberTickerIdx, setMemberTickerIdx] = useState(0);
  const [activeStatusIdx, setActiveStatusIdx] = useState<number | null>(null);
  const [activeAssigneeIdx, setActiveAssigneeIdx] = useState<number | null>(null);
  const [activeBarIdx, setActiveBarIdx] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const items = stats?.unassignedOpenTasksPreview || [];
    if (!items || items.length <= 1) return;
    const id = window.setInterval(() => {
      setUnassignedTickerIdx((prev) => (prev + 1) % items.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [stats?.unassignedOpenTasksPreview]);

  useEffect(() => {
    const items = stats?.recentTasks || [];
    if (!items || items.length <= 1) return;
    const id = window.setInterval(() => {
      setAssignedTickerIdx((prev) => (prev + 1) % items.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [stats?.recentTasks]);

  useEffect(() => {
    const items = dueTasks || [];
    if (!items || items.length <= 1) return;
    const id = window.setInterval(() => {
      setDueTickerIdx((prev) => (prev + 1) % items.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [dueTasks]);

  useEffect(() => {
    const items = stats?.members || [];
    if (!items || items.length <= 1) return;
    const id = window.setInterval(() => {
      setMemberTickerIdx((prev) => (prev + 1) % items.length);
    }, 5000);
    return () => window.clearInterval(id);
  }, [stats?.members]);
  const { notifications, unreadCount: notifUnread, markTaskAsRead, resetUnreadCount } = useNotifications();
  const { unreadCounts } = useAppSelector(state => state.message);
  const currentUser = useAppSelector((state) => state.user.currentUser);
  const currentOrg = useAppSelector((state) => state.organization.currentOrg);
  const socket = useSocket();

  const { isSuperAdmin, isAdmin } = useOrgRole();
  const unreadDMCount = Object.values(unreadCounts).reduce((a: number, b: number) => a + b, 0);

  // AbortController for cancelling in-flight requests on unmount / org switch
  const abortRef = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async () => {
    // Cancel any previous load
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = currentOrg?.id ? `?orgId=${currentOrg.id}` : '';
      const [statsRes, dueRes, chartRes] = await batchRequests([
        () => api.get(`/dashboard/stats${params}`, { signal: controller.signal }),
        () => api.get(`/dashboard/due-tasks${params}`, { signal: controller.signal }),
        () => api.get(`/dashboard/chart-data${params}`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (statsRes.data.success) {
        setStats(statsRes.data.data);
        setRecentTasks(statsRes.data.data.recentTasks || []);
        dispatch(fetchUnreadCounts());
      }
      if (dueRes.data.success) {
        setDueTasks(dueRes.data.data.dueTasks || []);
        setIsAdminLevel(dueRes.data.data.isAdminLevel || false);
      }
      if (chartRes.data.success) {
        setChartData(chartRes.data.data);
      }
    } catch (err: any) {
      if (err?.code === 'ERR_CANCELED') return;
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, [currentOrg?.id, dispatch]);

  useEffect(() => {
    loadDashboard();
    return () => { abortRef.current?.abort(); };
  }, [loadDashboard]);

  // Real-time listeners
  useEffect(() => {
    if (!socket) return;

    let timeout: any;
    const handleRefresh = () => {
      clearTimeout(timeout);
      timeout = setTimeout(loadDashboard, 300);
    };

    socket.on('notification:new', handleRefresh);
    socket.on('dashboard:refresh', handleRefresh);
    socket.on('people:updated', handleRefresh);
    socket.on('task:updated', handleRefresh);
    socket.on('task:refresh', handleRefresh);
    socket.on('notification:read_sync', handleRefresh);
    socket.on('notification:read_all_sync', handleRefresh);
    socket.on('notification:task_read_sync', handleRefresh);

    socket.on('users:online-list', (users: string[]) => {
      if (Array.isArray(users)) setOnlineUserIds(users);
    });

    socket.on('user:online', (data: { userId: string }) => {
      if (data?.userId) {
        setOnlineUserIds(prev => Array.from(new Set([...prev, data.userId])));
      }
    });

    socket.on('messages:read-receipt', (data: any) => {
      if (data?.readBy === currentUser?.id && data.senderId) {
        dispatch(resetUnread(data.senderId));
      }
      handleRefresh();
    });

    socket.on('user:offline', (data: { userId: string }) => {
      if (data?.userId) {
        setOnlineUserIds(prev => prev.filter(id => id !== data.userId));
      }
    });

    return () => {
      clearTimeout(timeout);
      socket.off('notification:new', handleRefresh);
      socket.off('dashboard:refresh', handleRefresh);
      socket.off('people:updated', handleRefresh);
      socket.off('task:updated', handleRefresh);
      socket.off('task:refresh', handleRefresh);
      socket.off('notification:read_sync', handleRefresh);
      socket.off('notification:read_all_sync', handleRefresh);
      socket.off('notification:task_read_sync', handleRefresh);
      socket.off('message:new');
      socket.off('messages:read-receipt');
      socket.off('users:online-list');
      socket.off('user:online');
      socket.off('user:offline');
    };
  }, [socket, loadDashboard, currentUser?.id]);

  if (loading) {
    return (
      <div className="w-full min-w-0 max-w-[1400px] mx-auto p-3 sm:p-4 md:p-8 space-y-6 sm:space-y-8">
        <div className="h-40 sm:h-48 w-full rounded-2xl animate-pulse bg-gray-100 dark:bg-gray-800" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-28 sm:h-32 rounded-2xl animate-pulse bg-gray-50 dark:bg-gray-800/50" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full h-full overflow-y-auto overflow-x-hidden px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 space-y-5 sm:space-y-6 md:space-y-8 font-sans scroll-smooth custom-scrollbar">

      {/* ── Welcome Area ── */}
      <div className="space-y-4">
        <GreetingSection
          name={currentUser?.firstName || 'there'}
          isAdminLike={isSuperAdmin || isAdmin}
          storageUsedBytes={stats?.storageUsedBytes}
          attachmentCount={stats?.attachmentCount}
          totalStorageUsedBytes={stats?.totalStorageUsedBytes}
          totalAttachmentCount={stats?.totalAttachmentCount}
          openTaskCount={stats?.openTaskCount}
          unassignedOpenTaskCount={stats?.unassignedOpenTaskCount}
          memberCount={stats?.memberCount}
          onlineMembers={(stats?.members || []).filter(m => onlineUserIds.includes(m.id))}
        />
      </div>

      {/* ── Highlights Grid ── */}
      <ScrollReveal delay={0.1}>
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
          {!(isSuperAdmin || isAdmin) && (
            <StatCard
              delay={0.12}
              label="Total Completed Tasks"
              value={stats?.completedTaskCount ?? 0}
              link="/tasks/assigned"
              colorClass="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
          )}
          <StatCard
            delay={0.2}
            label="Tasks Assigned"
            value={stats?.taskCount || 0}
            link="/tasks/assigned"
            hoverTitle="Recent tasks"
            hoverItems={(stats?.recentTasks || []).map((t: any) => ({ id: t.id, title: t.title }))}
            tickerLabel={(stats?.recentTasks?.length || 0) > 0 ? 'Now showing' : undefined}
            tickerValue={(stats?.recentTasks?.length || 0) > 0 ? ((stats?.recentTasks || [])[assignedTickerIdx]?.title || '') : undefined}
            onTickerClick={() => {
              const t = (stats?.recentTasks || [])[assignedTickerIdx];
              if (!t?.id) return;
              navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
            }}
            onHoverItemClick={(t: any) => {
              if (!t?.id) return;
              navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
            }}
            colorClass="bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
            icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>}
          />
          {(isSuperAdmin || isAdmin) && (
            <StatCard
              delay={0.28}
              label="Unassigned Open Tasks"
              value={stats?.unassignedOpenTaskCount ?? 0}
              link="/tasks/assigned"
              hoverItems={stats?.unassignedOpenTasksPreview || []}
              tickerLabel={(stats?.unassignedOpenTasksPreview?.length || 0) > 0 ? 'Now showing' : undefined}
              tickerValue={(stats?.unassignedOpenTasksPreview?.length || 0) > 0
                ? ((stats?.unassignedOpenTasksPreview || [])[unassignedTickerIdx]?.title || '')
                : undefined}
              onTickerClick={() => {
                const t = (stats?.unassignedOpenTasksPreview || [])[unassignedTickerIdx];
                if (!t?.id) return;
                navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
              }}
              onHoverItemClick={(t: any) => {
                if (!t?.id) return;
                navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
              }}
              colorClass="bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
              icon={
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V6a4 4 0 118 0v1m-9 4h10m-9 8h8a2 2 0 002-2v-7a2 2 0 00-2-2H8a2 2 0 00-2 2v7a2 2 0 002 2z" />
                </svg>
              }
            />
          )}
          <StatCard
            delay={0.3}
            label="Team Members"
            value={stats?.memberCount || 0}
            link="/people"
            avatars={stats?.members}
            // Hide the hover "top members" panel (red boxed area).
            hoverItems={[]}
            tickerLabel={(stats?.members?.length || 0) > 0 ? 'Now showing' : undefined}
            tickerValue={(stats?.members?.length || 0) > 0 ? ((stats?.members || [])[memberTickerIdx]?.name || '') : undefined}
            tickerAvatarUrl={(stats?.members?.length || 0) > 0 ? ((stats?.members || [])[memberTickerIdx]?.avatarUrl || null) : null}
            tickerInitial={(stats?.members?.length || 0) > 0 && !((stats?.members || [])[memberTickerIdx]?.avatarUrl)
              ? (((stats?.members || [])[memberTickerIdx]?.name || '').trim().charAt(0) || '')
              : ''}
            onTickerClick={() => navigate('/people')}
            onHoverItemClick={() => navigate('/people')}
            colorClass="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"
            icon={<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
          />
          <StatCard
            delay={0.4}
            label="Due Tasks"
            value={dueTasks.length}
            link="/tasks/assigned"
            hoverTitle="Due tasks"
            hoverItems={dueTasks.map((t: any) => ({ id: t.id, title: t.title }))}
            tickerLabel={dueTasks.length > 0 ? 'Now showing' : undefined}
            tickerValue={dueTasks.length > 0 ? (dueTasks[dueTickerIdx]?.title || '') : undefined}
            onTickerClick={() => {
              const t = dueTasks[dueTickerIdx];
              if (!t?.id) return;
              navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
            }}
            onHoverItemClick={(t: any) => {
              if (!t?.id) return;
              navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } });
            }}
            colorClass="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400"
            icon={
            <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          } />
        </div>
      </ScrollReveal>

      {/* ── Due Tasks Scrolling Ticker ── */}
      {dueTasks.length > 0 && (
        <ScrollReveal delay={0.15}>
          <DueTasksTicker tasks={dueTasks} onTaskClick={(task) => navigate(`/tasks/${task.id}`, { state: { backgroundLocation: location } })} />
        </ScrollReveal>
      )}

      {/* ── Charts Section ── */}
      {(isSuperAdmin || isAdmin) && chartData && (chartData.workloadByStatus?.length > 0 || chartData.totalTasksByAssignee?.length > 0 || chartData.openTasksByAssignee?.length > 0) && (
        <ScrollReveal delay={0.2}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 min-w-0">
            {/* Workload by Status - Pie Chart */}
            <motion.div
              onClick={() => setChartModal({ open: true, chartType: 'workloadByStatus', chartTitle: 'Workload by Status', chartData: chartData.workloadByStatus, selectedSegment: chartData.workloadByStatus[0]?.name || null })}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              whileHover={{ y: -6, scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="relative overflow-hidden bg-white dark:bg-gray-800/80 rounded-2xl sm:rounded-3xl border border-gray-100 dark:border-gray-700/50 p-3 sm:p-6 shadow-sm min-h-[320px] sm:min-h-[400px] flex flex-col min-w-0 cursor-pointer hover:shadow-2xl hover:border-indigo-200 dark:hover:border-indigo-700 transition-all group"
            >
              <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-purple-500/10 blur-3xl" />
              </div>
              <h3 className="text-sm font-black text-gray-900 dark:text-white mb-4 uppercase tracking-wide group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Workload by Status</h3>
              <div className="flex-1 w-full flex items-center justify-center min-w-0 overflow-x-auto">
                {chartData.workloadByStatus.length > 0 && mounted ? (
                  <StableChartFrame className="w-full min-w-[200px] h-[280px] sm:h-[360px]" minWidth={200} minHeight={280}>
                    {({ width, height }) => (
                      <PieChart width={width} height={height} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                        <PieWithActive
                          data={chartData.workloadByStatus}
                          cx="50%"
                          cy="50%"
                          outerRadius={85}
                          dataKey="value"
                          isAnimationActive={false}
                          activeIndex={activeStatusIdx ?? undefined}
                          activeShape={(props: any) => (
                            <Sector {...props} outerRadius={(props.outerRadius || 0) + 10} />
                          )}
                          onMouseLeave={() => setActiveStatusIdx(null)}
                          onMouseEnter={(_d: any, idx: number) => setActiveStatusIdx(idx)}
                          labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
                          label={({ cx, cy, midAngle, outerRadius, name, percent }) => {
                            const RADIAN = Math.PI / 180;
                            const angle = midAngle ?? 0;
                            const radius = outerRadius + 28;
                            const x = cx + radius * Math.cos(-angle * RADIAN);
                            const y = cy + radius * Math.sin(-angle * RADIAN);
                            const pct = ((percent || 0) * 100).toFixed(1);
                            return (
                              <text
                                x={x}
                                y={y}
                                fill="#374151"
                                textAnchor={x > cx ? 'start' : 'end'}
                                dominantBaseline="central"
                                style={{ fontSize: '11px', fontWeight: 600 }}
                              >
                                {`${(name || '').replace(/_/g, ' ')}${(percent || 0) >= 0.02 ? ` ${pct}%` : ''}`}
                              </text>
                            );
                          }}
                          strokeWidth={2}
                        >
                          {chartData.workloadByStatus.map((entry: any, index) => (
                            <Cell
                              key={`cell-status-${index}`}
                              fill={statusColor(entry?.name)}
                              opacity={activeStatusIdx === null || activeStatusIdx === index ? 1 : 0.45}
                            />
                          ))}
                        </PieWithActive>
                        <Tooltip content={<PrettyTooltip />} />
                      </PieChart>
                    )}
                  </StableChartFrame>
                ) : (
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">No data available</p>
                )}
              </div>
            </motion.div>

            {/* Total Tasks by Assignee - Pie Chart */}
            <motion.div
              onClick={() => setChartModal({ open: true, chartType: 'totalTasksByAssignee', chartTitle: 'Total Tasks by Assignee', chartData: chartData.totalTasksByAssignee, selectedSegment: chartData.totalTasksByAssignee[0]?.name || null })}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.04 }}
              whileHover={{ y: -6, scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="relative overflow-hidden bg-white dark:bg-gray-800/80 rounded-2xl sm:rounded-3xl border border-gray-100 dark:border-gray-700/50 p-3 sm:p-6 shadow-sm min-h-[320px] sm:min-h-[400px] flex flex-col min-w-0 cursor-pointer hover:shadow-2xl hover:border-indigo-200 dark:hover:border-indigo-700 transition-all group"
            >
              <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-sky-500/10 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-amber-500/10 blur-3xl" />
              </div>
              <h3 className="text-sm font-black text-gray-900 dark:text-white mb-4 uppercase tracking-wide group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Total Tasks by Assignee</h3>
              <div className="flex-1 w-full flex items-center justify-center min-w-0 overflow-x-auto">
                {chartData.totalTasksByAssignee.length > 0 && mounted ? (
                  <StableChartFrame className="w-full min-w-[200px] h-[280px] sm:h-[360px]" minWidth={200} minHeight={280}>
                    {({ width, height }) => (
                      <PieChart width={width} height={height} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
                        <PieWithActive
                          data={chartData.totalTasksByAssignee}
                          cx="50%"
                          cy="50%"
                          outerRadius={85}
                          dataKey="value"
                          isAnimationActive={false}
                          activeIndex={activeAssigneeIdx ?? undefined}
                          activeShape={(props: any) => (
                            <Sector {...props} outerRadius={(props.outerRadius || 0) + 10} />
                          )}
                          onMouseLeave={() => setActiveAssigneeIdx(null)}
                          onMouseEnter={(_d: any, idx: number) => setActiveAssigneeIdx(idx)}
                          labelLine={{ stroke: '#9ca3af', strokeWidth: 1 }}
                          label={({ cx, cy, midAngle, outerRadius, name, percent }) => {
                            const RADIAN = Math.PI / 180;
                            const angle = midAngle ?? 0;
                            const radius = outerRadius + 28;
                            const x = cx + radius * Math.cos(-angle * RADIAN);
                            const y = cy + radius * Math.sin(-angle * RADIAN);
                            const pct = ((percent || 0) * 100).toFixed(1);
                            return (
                              <text
                                x={x}
                                y={y}
                                fill="#374151"
                                textAnchor={x > cx ? 'start' : 'end'}
                                dominantBaseline="central"
                                style={{ fontSize: '11px', fontWeight: 600 }}
                              >
                                {`${name}${(percent || 0) >= 0.02 ? ` ${pct}%` : ''}`}
                              </text>
                            );
                          }}
                          strokeWidth={2}
                        >
                          {chartData.totalTasksByAssignee.map((_entry, index) => (
                            <Cell
                              key={`cell-assignee-${index}`}
                              fill={ASSIGNEE_COLORS[index % ASSIGNEE_COLORS.length]}
                              opacity={activeAssigneeIdx === null || activeAssigneeIdx === index ? 1 : 0.45}
                            />
                          ))}
                        </PieWithActive>
                        <Tooltip content={<PrettyTooltip />} />
                      </PieChart>
                    )}
                  </StableChartFrame>
                ) : (
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">No data available</p>
                )}
              </div>
            </motion.div>

            {/* Open Tasks by Assignee - Bar Chart */}
            <motion.div
              onClick={() => setChartModal({ open: true, chartType: 'openTasksByAssignee', chartTitle: 'Open Tasks by Assignee', chartData: chartData.openTasksByAssignee, selectedSegment: chartData.openTasksByAssignee[0]?.name || null })}
              initial={{ opacity: 0, y: 14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut', delay: 0.08 }}
              whileHover={{ y: -6, scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
              className="relative overflow-hidden bg-white dark:bg-gray-800/80 rounded-2xl sm:rounded-3xl border border-gray-100 dark:border-gray-700/50 p-3 sm:p-6 shadow-sm min-h-[300px] sm:min-h-[340px] flex flex-col min-w-0 cursor-pointer hover:shadow-2xl hover:border-indigo-200 dark:hover:border-indigo-700 transition-all group"
            >
              <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-emerald-500/10 blur-3xl" />
                <div className="absolute -bottom-24 -left-24 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl" />
              </div>
              <h3 className="text-sm font-black text-gray-900 dark:text-white mb-4 uppercase tracking-wide group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Open Tasks by Assignee</h3>
              <div className="flex-1 w-full flex items-center justify-center min-w-0 overflow-x-auto">
                {chartData.openTasksByAssignee.length > 0 && mounted ? (
                  <StableChartFrame className="w-full min-w-[240px] h-[240px] sm:h-[280px]" minWidth={240} minHeight={240}>
                    {({ width, height }) => (
                      <BarChart width={width} height={height} data={chartData.openTasksByAssignee} margin={{ top: 5, right: 4, left: 0, bottom: 48 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 10, fill: '#6b7280' }}
                          angle={-45}
                          textAnchor="end"
                          interval={0}
                          height={60}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} allowDecimals={false} />
                        <Tooltip content={<PrettyTooltip />} />
                        <Bar
                          dataKey="Tasks"
                          radius={[6, 6, 0, 0]}
                          onMouseLeave={() => setActiveBarIdx(null)}
                          onMouseEnter={(_data: any, idx: number) => setActiveBarIdx(idx)}
                        >
                          {chartData.openTasksByAssignee.map((_entry, index) => (
                            <Cell
                              key={`cell-bar-${index}`}
                              fill={ASSIGNEE_COLORS[index % ASSIGNEE_COLORS.length]}
                              opacity={activeBarIdx === null || activeBarIdx === index ? 1 : 0.45}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </StableChartFrame>
                ) : (
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">No data available</p>
                )}
              </div>
            </motion.div>
          </div>
        </ScrollReveal>
      )}

      {/* Chart Detail Modal */}
      {(isSuperAdmin || isAdmin) && chartData && (
        <ChartDetailModal
          open={chartModal.open}
          onClose={() => setChartModal(prev => ({ ...prev, open: false }))}
          chartType={chartModal.chartType}
          chartTitle={chartModal.chartTitle}
          chartData={chartModal.chartData}
          selectedSegment={chartModal.selectedSegment}
          orgId={currentOrg?.id || ''}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 lg:gap-8 items-start min-w-0">

        {/* Main Workspace Column — Tabbed Feed */}
        <ScrollReveal delay={0.15} className="lg:col-span-7 xl:col-span-8 min-w-0 space-y-4 sm:space-y-6">
          <div className="bg-white dark:bg-gray-800/80 rounded-2xl sm:rounded-3xl border border-gray-100 dark:border-gray-700/50 p-3 sm:p-6 md:p-8 shadow-sm min-w-0">
            {/* Tab Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 sm:mb-6 min-w-0">
              <div className="flex items-center gap-0.5 sm:gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-xl p-1 min-w-0 flex-1 sm:flex-initial">
                <button
                  onClick={() => setActiveTab('feed')}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'feed'
                    ? 'bg-white dark:bg-gray-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                  <span className="flex items-center justify-center gap-1.5 sm:gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <span className="truncate">Feed</span>
                  </span>
                </button>
                <button
                  onClick={() => setActiveTab('due')}
                  className={`flex-1 sm:flex-initial px-2.5 sm:px-4 py-2 rounded-lg text-[10px] sm:text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'due'
                    ? 'bg-white dark:bg-gray-800 text-red-600 dark:text-red-400 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}
                >
                  <span className="flex items-center justify-center gap-1.5 sm:gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="truncate">Due</span>
                    {dueTasks.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-red-500 text-[8px] font-black text-white leading-none shrink-0">{dueTasks.length}</span>
                    )}
                  </span>
                </button>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0">
                {activeTab === 'feed' ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100 dark:border-emerald-800/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Live
                    </div>
                    <Link to="/inbox" className="text-[10px] font-black text-indigo-500 hover:text-indigo-600 uppercase tracking-widest hover:underline">View All</Link>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-full text-[10px] font-black uppercase tracking-widest border border-red-100 dark:border-red-800/50">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                      {dueTasks.length} Due
                    </div>
                    <Link to="/tasks/assigned" className="text-[10px] font-black text-indigo-500 hover:text-indigo-600 uppercase tracking-widest hover:underline">View All</Link>
                  </>
                )}
              </div>
            </div>

            {/* Tab Content */}
            {activeTab === 'feed' ? (
              <div className="max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                <InboxFeed notifications={notifications} markTaskAsRead={markTaskAsRead} />
              </div>
            ) : (
              isAdminLevel ? (
                <DueTasksMarquee tasks={dueTasks} onTaskClick={(t) => navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } })} />
              ) : (
                <PersonalDueTasksList tasks={dueTasks} onTaskClick={(t) => navigate(`/tasks/${t.id}`, { state: { backgroundLocation: location } })} />
              )
            )}
          </div>
        </ScrollReveal>

        {/* Right Sidebar: Real-time Presence */}
        <ScrollReveal delay={0.25} className="lg:col-span-5 xl:col-span-4 min-w-0 space-y-4 sm:space-y-6">
          <div className="bg-indigo-600 rounded-2xl sm:rounded-3xl p-4 sm:p-5 md:p-7 text-white shadow-xl relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-base sm:text-lg font-black mb-1">Collaboration Pulse</h3>
              <p className="text-[10px] sm:text-xs text-indigo-200 font-bold uppercase tracking-widest mb-4 sm:mb-6">{onlineUserIds.length} Team Members Online</p>

              <div className="flex flex-wrap gap-3">
                {onlineUserIds.map((userId, idx) => {
                  const member = stats?.members?.find(m => m.id === userId);
                  const name = member?.name || 'Teammate';
                  const avatar = member?.avatarUrl;

                  return (
                    <motion.div key={userId} initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: idx * 0.15, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}>
                      <div className="relative group" title={name}>
                        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-indigo-500/50 border border-white/20 overflow-hidden shadow-sm group-hover:scale-110 transition-transform flex items-center justify-center font-black text-sm sm:text-base">
                          {avatar ? (
                            <img
                              src={avatar}
                              alt={name}
                              className="w-full h-full object-cover"
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          ) : (
                            <span className="text-white/90">{name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-emerald-500 rounded-full border border-indigo-600 shadow-sm" />
                      </div>
                    </motion.div>
                  );
                })}
                {onlineUserIds.length === 0 && <p className="text-sm font-medium opacity-60 italic">Your team is resting...</p>}
              </div>

              <button className="w-full mt-10 py-3.5 bg-white text-indigo-600 text-[10px] font-black rounded-2xl uppercase tracking-widest shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95">
                Start Group Chat
              </button>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-12 translate-x-12" />
          </div>

          <div className="bg-white dark:bg-gray-800/80 rounded-2xl sm:rounded-3xl border border-gray-100 dark:border-gray-700/50 p-4 sm:p-6 md:p-7 shadow-sm">
            <h3 className="text-sm font-black text-gray-900 dark:text-white mb-4 uppercase tracking-widest">Real-time Stats</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500">Sync Status</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 text-[10px] font-black uppercase tracking-tighter shadow-sm border border-emerald-100 dark:border-emerald-800">Connected</span>
              </div>
              <div className="h-1 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                <motion.div initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }} className="h-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
              </div>
            </div>
          </div>
        </ScrollReveal>

      </div>
    </div>
  );
}
