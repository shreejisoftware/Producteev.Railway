import React, { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useSocket } from '../../hooks/useSocket';
import { useOrgRole } from '../../hooks/useOrgRole';
import api from '../../services/api';
import { useToast } from '../../components/ui/Toast';
import { Loading } from '../../components/ui/Loading';
import { useAppSelector } from '../../store';
import { playNotificationReceived } from '../../utils/notificationSound';
import { openOAuthPopup } from '../../utils/openOAuthPopup';
import '../../components/chat/ChatPanel.css';

type SlackChannel = { id: string; name: string; topic?: string; isMember?: boolean };
type SlackMessage = {
  ts: string;
  text: string;
  user: string | null;
  userName?: string | null;
  userAvatar?: string | null;
  channel: string;
  file?: { id: string; name: string; mimetype?: string } | null;
};

type SlackActivityItem = {
  channelId: string;
  channelName: string;
  isPrivate: boolean;
  ts: string;
  text: string;
  user: string | null;
  file?: { id: string; name: string; mimetype?: string } | null;
};
type SlackApiMessage = SlackMessage & { files?: Array<{ id: string; name: string; mimetype?: string }> };
type MentionMember = { id: string; firstName: string; lastName: string; email?: string; role?: string };
type PendingUpload = { id: string; file: File; previewUrl?: string };

function slackOAuthRedirectErrorMessage(code: string) {
  const c = String(code || '').trim();
  switch (c) {
    case 'invalid_team_for_non_distributed_app':
      return (
        'Slack blocked install on that workspace because this Slack app is not distributed. ' +
        'Install/connect on the same workspace where the app was created, enable distribution in Slack app settings, ' +
        'or set SLACK_TEAM_ID in the backend to the correct Team ID (starts with T…).'
      );
    case 'access_denied':
      return 'Slack authorization was cancelled.';
    case 'invalid_scope':
      return 'Slack rejected the requested permissions (invalid_scope). Update the Slack app OAuth scopes to match what Producteev requests.';
    default:
      return `Slack connection failed: ${c.replace(/_/g, ' ')}`;
  }
}

type SlackMessageItemProps = {
  m: SlackMessage;
  slackProfiles: Record<string, { name: string; avatar: string | null }>;
  brokenAvatars: Record<string, boolean>;
  onAvatarError: (url: string) => void;
  fileBlobs: Record<string, string>;
  fileErrors: Record<string, string>;
  orgId: string;
};

const SlackMessageItem = React.memo(function SlackMessageItem({
  m,
  slackProfiles,
  brokenAvatars,
  onAvatarError,
  fileBlobs,
  fileErrors,
  orgId,
}: SlackMessageItemProps) {
  const isImageFile = (f: { name: string; mimetype?: string } | null | undefined) => {
    if (!f) return false;
    const mt = String(f.mimetype || '').toLowerCase();
    if (mt.startsWith('image/')) return true;
    const name = String(f.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some((ext) => name.endsWith(ext));
  };

  const formatSlackTs = (ts: string) => {
    const raw = Number(ts);
    if (!Number.isFinite(raw) || raw <= 0) return '';
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    try {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
    } catch {
      return '';
    }
  };

  const initialsFor = (label: string) => {
    const s = String(label || '').trim();
    if (!s) return '?';
    const parts = s.split(/\\s+/g).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
    return (a + b).toUpperCase() || '?';
  };

  const displayName =
    m.userName ||
    (m.user && slackProfiles[m.user]?.name ? slackProfiles[m.user]!.name : m.user ? `USER ${m.user}` : m.file && !m.text ? 'Uploading…' : 'BOT');

  return (
    <div className="flex w-full justify-start">
      <div className="w-[350px] max-w-[350px]">
        <div className="flex items-start gap-3 group">
          {m.userAvatar && !brokenAvatars[m.userAvatar] ? (
            <img
              src={m.userAvatar}
              alt={displayName || 'User'}
              className="h-9 w-9 rounded-full object-cover border border-gray-200 dark:border-gray-800 bg-white"
              onError={() => onAvatarError(String(m.userAvatar || ''))}
            />
          ) : (
            <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-black select-none">
              {initialsFor(displayName)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100 truncate">{displayName}</div>
              <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest shrink-0">{formatSlackTs(m.ts)}</div>
            </div>

            {m.file && isImageFile(m.file) ? (
              <div className="mt-2 flex flex-col items-start">
                {(() => {
                  const apiUrl = `/api/v1/slack/files/${encodeURIComponent(m.file.id)}?orgId=${encodeURIComponent(orgId || '')}`;
                  const blobUrl = fileBlobs[m.file.id];
                  const openHref = blobUrl || apiUrl;
                  const downloadHref = blobUrl || apiUrl;
                  return blobUrl ? (
                    <div className="w-full">
                      <div className="relative w-full">
                        <a href={openHref} target="_blank" rel="noreferrer" className="w-full flex justify-start">
                          <img
                            src={blobUrl}
                            alt={m.file.name}
                            className="block w-full max-w-full h-auto max-h-[80vh] object-contain rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950"
                          />
                        </a>
                        <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                          <a
                            href={downloadHref}
                            download={m.file.name}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/90 hover:bg-white text-gray-900 border border-gray-200 shadow-sm"
                            title="Download"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path
                                d="M8 11l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  ) : fileErrors[m.file.id] ? (
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      <div className="font-bold">{fileErrors[m.file.id]}</div>
                      <div className="mt-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                        <a
                          href={downloadHref}
                          download={m.file.name}
                          className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/80 hover:bg-white text-gray-900 border border-gray-200 shadow-sm"
                          title="Download"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            <path
                              d="M8 11l4 4 4-4"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path d="M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          </svg>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full">
                      <div className="relative w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/40 p-3">
                        <div className="text-sm text-gray-500 dark:text-gray-400 font-bold">Loading image…</div>
                        <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                          <a
                            href={downloadHref}
                            download={m.file.name}
                            className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/90 hover:bg-white text-gray-900 border border-gray-200 shadow-sm"
                            title="Download"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                              <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              <path
                                d="M8 11l4 4 4-4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path d="M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-2 text-xs font-black text-gray-500 dark:text-gray-400 break-all">{m.file.name}</div>
              </div>
            ) : m.file ? (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-950/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-gray-900 dark:text-gray-100 break-all">{m.file.name}</div>
                    <div className="text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                      {m.file.mimetype ? String(m.file.mimetype) : 'FILE'}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                    <a
                      href={`/api/v1/slack/files/${encodeURIComponent(m.file.id)}?orgId=${encodeURIComponent(orgId || '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/80 hover:bg-white text-gray-900 border border-gray-200 shadow-sm"
                      title="Open"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M14 3h7v7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path
                          d="M21 14v7H3V3h7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </a>
                    <a
                      href={`/api/v1/slack/files/${encodeURIComponent(m.file.id)}?orgId=${encodeURIComponent(orgId || '')}`}
                      download={m.file.name}
                      className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/80 hover:bg-white text-gray-900 border border-gray-200 shadow-sm"
                      title="Download"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M12 3v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path
                          d="M8 11l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path d="M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{m.text}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export function SlackPage() {
  const socket = useSocket();
  const toast = useToast();
  const { isAdmin, isOwner, isSuperAdmin } = useOrgRole();
  const isSlackAdmin = isAdmin || isOwner || isSuperAdmin;
  const [searchParams, setSearchParams] = useSearchParams();
  const [configured, setConfigured] = useState(false);
  const [userConnected, setUserConnected] = useState(false);
  const [hideSlackIdentityBanner, setHideSlackIdentityBanner] = useState(false);
  const [showIdentityLinkedBanner, setShowIdentityLinkedBanner] = useState(false);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, SlackMessage[]>>({});
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [viewMode, setViewMode] = useState<'activity' | 'channels'>('channels');
  const [activity, setActivity] = useState<SlackActivityItem[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [unreadByChannel, setUnreadByChannel] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState('');
  const [connectUrl, setConnectUrl] = useState<string | null>(null);
  const [connectUserUrl, setConnectUserUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const currentOrg = useAppSelector((s) => s.organization.currentOrg);
  const currentUser = useAppSelector((s: any) => (s as any).user?.currentUser ?? null);

  const slackIdentityBannerKey = useMemo(
    () => (currentOrg?.id ? `slackIdentityBannerDismissed:${currentOrg.id}` : 'slackIdentityBannerDismissed'),
    [currentOrg?.id]
  );
  const slackLastChannelKey = useMemo(
    () => (currentOrg?.id ? `slackLastChannelId:${currentOrg.id}` : ''),
    [currentOrg?.id]
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const activeChannelIdRef = useRef<string | null>(null);
  const stickToBottomRef = useRef<boolean>(true);
  const viewModeRef = useRef<'activity' | 'channels'>('channels');
  const lastSeenTsByChannelRef = useRef<Record<string, string>>({});
  const [fileBlobs, setFileBlobs] = useState<Record<string, string>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [brokenAvatars, setBrokenAvatars] = useState<Record<string, boolean>>({});
  const [composerDragOver, setComposerDragOver] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [mentionCandidates, setMentionCandidates] = useState<MentionMember[]>([]);
  const [mentionState, setMentionState] = useState<{ start: number; query: string } | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [uploadingNow, setUploadingNow] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [showFormatBar, setShowFormatBar] = useState(true);
  const [showAllChannels, setShowAllChannels] = useState(false);

  const handleAvatarError = useCallback((url: string) => {
    const key = String(url || '');
    if (!key) return;
    setBrokenAvatars((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);
  const [slackProfiles, setSlackProfiles] = useState<Record<string, { name: string; avatar: string | null }>>({});
  const [channelRowMenuId, setChannelRowMenuId] = useState<string | null>(null);
  const channelRowMenuRef = useRef<HTMLDivElement | null>(null);
  const [channelsMenuOpen, setChannelsMenuOpen] = useState(false);
  const channelsMenuRef = useRef<HTMLDivElement | null>(null);
  const [channelAccess, setChannelAccess] = useState<Record<string, string[]>>({});
  const [manageAccessChannelId, setManageAccessChannelId] = useState<string | null>(null);
  const [manageSelected, setManageSelected] = useState<Record<string, boolean>>({});
  const [manageSearch, setManageSearch] = useState('');

  const channelFilterKey = useMemo(
    () => (currentOrg?.id ? `slackChannelFilter:${currentOrg.id}` : 'slackChannelFilter'),
    [currentOrg?.id]
  );

  const visibleChannels = useMemo(() => {
    if (showAllChannels) return channels;
    // Default: show only channels the bot/user is a member of.
    return channels.filter((c) => c.isMember !== false);
  }, [channels, showAllChannels]);

  useEffect(() => {
    if (!channelRowMenuId) return;
    const onClick = (e: MouseEvent) => {
      if (channelRowMenuRef.current && !channelRowMenuRef.current.contains(e.target as Node)) setChannelRowMenuId(null);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [channelRowMenuId]);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(channelFilterKey);
      // default: joined only
      setShowAllChannels(v === 'all');
    } catch {
      setShowAllChannels(false);
    }
  }, [channelFilterKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(channelFilterKey, showAllChannels ? 'all' : 'joined');
    } catch {
      /* ignore */
    }
  }, [channelFilterKey, showAllChannels]);

  useEffect(() => {
    if (!channelsMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (channelsMenuRef.current && !channelsMenuRef.current.contains(e.target as Node)) setChannelsMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [channelsMenuOpen]);

  const activeMessages = useMemo(() => (activeChannelId ? (messages[activeChannelId] || []) : []), [messages, activeChannelId]);

  const isImageFile = (f: { name: string; mimetype?: string } | null | undefined) => {
    if (!f) return false;
    const mt = String(f.mimetype || '').toLowerCase();
    if (mt.startsWith('image/')) return true;
    const name = String(f.name || '').toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.webp'].some((ext) => name.endsWith(ext));
  };

  const formatSlackTs = (ts: string) => {
    const raw = Number(ts);
    if (!Number.isFinite(raw) || raw <= 0) return '';
    // Slack ts is seconds (with decimals). Our optimistic ones may be ms.
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    try {
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
    } catch {
      return '';
    }
  };

  const initialsFor = (label: string) => {
    const s = String(label || '').trim();
    if (!s) return '?';
    const parts = s.split(/\s+/g).filter(Boolean);
    const a = parts[0]?.[0] || '';
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : '';
    return (a + b).toUpperCase() || '?';
  };

  const filteredMentionMembers = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return mentionCandidates
      .filter((m) => {
        const n = `${m.firstName} ${m.lastName}`.trim().toLowerCase();
        const em = (m.email || '').toLowerCase();
        return !q || n.includes(q) || em.includes(q);
      })
      .slice(0, 10);
  }, [mentionState, mentionCandidates]);

  useEffect(() => {
    if (!currentOrg?.id || !configured) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: any[] }>(`/organizations/${currentOrg.id}/members`);
        if (cancelled || !res.data.success) return;
        const users: MentionMember[] = (res.data.data || [])
          .map((row: any) => row.user ?? row)
          .filter((u: any) => u?.id)
          .map((u: any) => ({
            id: String(u.id),
            firstName: String(u.firstName || ''),
            lastName: String(u.lastName || ''),
            email: u.email ? String(u.email) : undefined,
            role: u.role ? String(u.role) : undefined,
          }));
        setMentionCandidates(users);
      } catch {
        if (!cancelled) setMentionCandidates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrg?.id, configured]);

  useEffect(() => {
    if (!currentOrg?.id || !configured) return;
    api
      .get<{ success: boolean; data: Record<string, string[]> }>(`/slack/channel-access`, { params: { orgId: currentOrg.id } })
      .then((res) => {
        if (res.data.success) setChannelAccess(res.data.data || {});
      })
      .catch(() => {
        // non-admins will get 403; ignore
      });
  }, [currentOrg?.id, configured]);

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setAttachMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [attachMenuOpen]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [mentionState?.start, mentionState?.query]);

  const getEditorText = () => (editorRef.current?.innerText || '').replace(/\u00A0/g, ' ').replace(/\r?\n/g, '\n').trimEnd();

  const getCaretOffsetInEditor = () => {
    const root = editorRef.current;
    if (!root) return null;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.startContainer)) return null;
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  };

  const syncMentionFromCursor = () => {
    const value = getEditorText();
    setDraft(value);
    const cursor = getCaretOffsetInEditor() ?? value.length;
    const before = value.slice(0, cursor);
    const m = /@([\w.\-+@]*)$/.exec(before);
    if (m) setMentionState({ start: cursor - m[0].length, query: m[1] });
    else setMentionState(null);
  };

  const execFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    // execCommand is deprecated but still works cross-browser for simple rich text
    document.execCommand(command, false, value);
    syncMentionFromCursor();
  };

  const insertTextAtCursor = (text: string) => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, text);
    syncMentionFromCursor();
  };

  const renderMrkdwn = (text: string) => {
    // Minimal Slack-like mrkdwn preview (not full Slack spec)
    const parseInline = (input: string): Array<string | React.ReactElement> => {
      const nodes: Array<string | React.ReactElement> = [];
      let rest = input;
      const patterns: Array<{
        re: RegExp;
        render: (m: RegExpExecArray, key: string) => React.ReactElement;
      }> = [
        {
          re: /`([^`]+)`/,
          render: (m, key) => (
            <code key={key} className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[12px]">
              {m[1]}
            </code>
          ),
        },
        {
          re: /\*([^*\n]+)\*/,
          render: (m, key) => (
            <strong key={key} className="font-black">
              {m[1]}
            </strong>
          ),
        },
        {
          re: /_([^_\n]+)_/,
          render: (m, key) => (
            <em key={key} className="italic">
              {m[1]}
            </em>
          ),
        },
        {
          re: /~([^~\n]+)~/,
          render: (m, key) => (
            <s key={key} className="line-through">
              {m[1]}
            </s>
          ),
        },
        {
          re: /<([^>|]+)\|([^>]+)>/,
          render: (m, key) => (
            <a
              key={key}
              href={m[1]}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 dark:text-indigo-300 underline underline-offset-2"
            >
              {m[2]}
            </a>
          ),
        },
        {
          re: /<((?:https?:\/\/)[^>]+)>/,
          render: (m, key) => (
            <a
              key={key}
              href={m[1]}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-600 dark:text-indigo-300 underline underline-offset-2"
            >
              {m[1]}
            </a>
          ),
        },
      ];

      let keyIdx = 0;
      while (rest.length) {
        let best: { idx: number; len: number; m: RegExpExecArray; render: (m: RegExpExecArray, key: string) => React.ReactElement } | null =
          null;
        for (const p of patterns) {
          const m = p.re.exec(rest);
          if (!m) continue;
          const idx = m.index ?? 0;
          if (!best || idx < best.idx) best = { idx, len: m[0].length, m, render: p.render };
        }
        if (!best) {
          nodes.push(rest);
          break;
        }
        if (best.idx > 0) nodes.push(rest.slice(0, best.idx));
        nodes.push(best.render(best.m, `mk-${keyIdx++}`));
        rest = rest.slice(best.idx + best.len);
      }
      return nodes;
    };

    const lines = String(text || '').split('\n');
    return (
      <div className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
        {lines.map((line, i) => (
          <div key={`ln-${i}`} className="min-h-[1.25rem]">
            {parseInline(line)}
          </div>
        ))}
      </div>
    );
  };

  const pickMentionMember = (member: MentionMember) => {
    const label = `${member.firstName} ${member.lastName}`.trim() || member.email || 'teammate';
    insertTextAtCursor(`@${label} `);
    setMentionState(null);
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const isNearBottom = () => {
    const el = listRef.current;
    if (!el) return true;
    const threshold = 120; // px
    return el.scrollHeight - (el.scrollTop + el.clientHeight) <= threshold;
  };

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
  }, [activeChannelId]);

  useEffect(() => {
    stickToBottomRef.current = stickToBottom;
  }, [stickToBottom]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const noteSeenTs = useCallback((channelId: string, ts: string) => {
    if (!channelId || !ts) return;
    const prev = lastSeenTsByChannelRef.current[channelId];
    // Slack ts compares lexicographically for same format; convert to Number for safety.
    const p = Number(prev || 0);
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return;
    if (!prev || n > p) lastSeenTsByChannelRef.current[channelId] = ts;
  }, []);

  // When switching channels, jump to bottom
  useEffect(() => {
    if (!activeChannelId) return;
    // next tick so DOM paints messages first
    const t = window.setTimeout(() => scrollToBottom('auto'), 0);
    return () => window.clearTimeout(t);
  }, [activeChannelId]);

  // When new messages arrive, keep bottom only if user was near bottom
  useEffect(() => {
    if (!activeChannelId) return;
    if (!stickToBottom) return;
    const t = window.setTimeout(() => scrollToBottom('smooth'), 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, activeMessages.length]);

  // Join org socket room so multiple users see the same Slack messages in realtime
  useEffect(() => {
    if (!socket || !currentOrg?.id) return;
    socket.emit('join-organization', currentOrg.id);
    return () => {
      socket.emit('leave-organization', currentOrg.id);
    };
  }, [socket, currentOrg?.id]);

  useEffect(() => {
    try {
      setHideSlackIdentityBanner(window.localStorage.getItem(slackIdentityBannerKey) === '1');
    } catch {
      setHideSlackIdentityBanner(false);
    }
  }, [slackIdentityBannerKey]);

  useEffect(() => {
    if (!showIdentityLinkedBanner) return;
    const t = window.setTimeout(() => setShowIdentityLinkedBanner(false), 10000);
    return () => window.clearTimeout(t);
  }, [showIdentityLinkedBanner]);

  // Remember last opened channel per org so a full page reload re-selects it.
  useEffect(() => {
    if (!slackLastChannelKey || !activeChannelId) return;
    try {
      window.localStorage.setItem(slackLastChannelKey, activeChannelId);
    } catch {
      /* ignore */
    }
  }, [slackLastChannelKey, activeChannelId]);

  useEffect(() => {
    const orgId = currentOrg?.id;
    if (!orgId) return;

    let cancelled = false;
    (async () => {
      try {
        const error = searchParams.get('error');
        if (error) {
          toast.error(slackOAuthRedirectErrorMessage(error));
          setSearchParams({});
        }
        const justConnectedUser = searchParams.get('userConnected');

        const s = await api.get<{ success: boolean; data: { configured: boolean; oauthReady: boolean; userConnected?: boolean } }>(`/slack/status`, { params: { orgId } });
        if (cancelled) return;
        if (s.data.success) {
          setConfigured(Boolean(s.data.data.configured));
          const uc = Boolean((s.data.data as any).userConnected);
          setUserConnected(uc);
          if (uc) {
            try {
              window.localStorage.setItem(slackIdentityBannerKey, '1');
            } catch {}
            setHideSlackIdentityBanner(true);
          }
        }
        if (justConnectedUser && s.data.success) {
          const ok = Boolean((s.data.data as any).userConnected);
          if (ok) {
            toast.success('Connected to Slack — messages will post as you');
            setShowIdentityLinkedBanner(true);
          } else {
            toast.error('Slack identity did not finish connecting. Try Connect again.');
          }
          setSearchParams((prev) => {
            const n = new URLSearchParams(prev);
            n.delete('userConnected');
            return n;
          });
        }
        if (!s.data.data.configured) {
          setChannels([]);
          setActiveChannelId(null);
          setMessages({});
          return;
        }
        const res = await api.get<{ success: boolean; data: SlackChannel[] }>(`/slack/channels`, { params: { orgId } });
        if (cancelled) return;
        if (res.data.success) {
          const list = res.data.data || [];
          setChannels(list);
          const fromUrl = searchParams.get('channelId');
          const urlOk = Boolean(fromUrl && list.some((c) => c.id === fromUrl));
          let stored: string | null = null;
          try {
            stored = window.localStorage.getItem(`slackLastChannelId:${orgId}`);
          } catch {
            stored = null;
          }
          const storedOk = Boolean(stored && list.some((c) => c.id === stored));
          setActiveChannelId((prev) => {
            const prevOk = Boolean(prev && list.some((c) => c.id === prev));
            return (prevOk ? prev : null) || (urlOk ? fromUrl! : null) || (storedOk ? stored! : null);
          });
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.response?.data?.message || 'Failed to load Slack');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentOrg?.id, searchParams, slackIdentityBannerKey]);

  useEffect(() => {
    const fromUrl = searchParams.get('channelId');
    if (!fromUrl) return;
    if (channels.length > 0 && channels.some((c) => c.id === fromUrl)) {
      setActiveChannelId(fromUrl);
    }
  }, [searchParams, channels]);

  useEffect(() => {
    if (!activeChannelId || !configured || !currentOrg?.id) return;
    if (viewMode !== 'channels') return;
    const channelId = activeChannelId;
    const orgId = currentOrg.id;
    let cancelled = false;
    setLoadingMessages(true);
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: SlackApiMessage[] }>(`/slack/channels/${channelId}/messages`, {
          params: { limit: 60, orgId },
        });
        if (cancelled) return;
        if (res.data.success) {
          const list = (res.data.data || [])
            .map((m) => {
              const first = Array.isArray(m.files) && m.files.length > 0 ? m.files[0] : null;
              return {
                channel: m.channel || channelId,
                ts: m.ts,
                text: m.text || '',
                user: m.user || null,
                userName: (m as any).userName ?? null,
                userAvatar: (m as any).userAvatar ?? null,
                file: (m.file || (first ? { id: first.id, name: first.name, mimetype: first.mimetype } : null)) ?? null,
              } satisfies SlackMessage;
            })
            .slice()
            .reverse();
          setMessages((prev) => ({ ...prev, [channelId]: list }));
          // Mark latest as seen for this channel (so polling doesn't count old messages as unread)
          const latest = list[list.length - 1];
          if (latest?.ts) noteSeenTs(channelId, String(latest.ts));
        }
      } catch (e: any) {
        if (cancelled) return;
        const msg = e?.response?.data?.message || 'Failed to load messages';
        toast.error(msg);
        if (String(msg).toLowerCase().includes('not in this channel')) {
          // Ensure Join button appears for this channel
          setChannels((prev) => prev.map((c) => (c.id === channelId ? { ...c, isMember: false } : c)));
        }
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChannelId, configured, currentOrg?.id, viewMode, noteSeenTs]);

  useEffect(() => {
    if (!configured || !currentOrg?.id) return;
    if (viewMode !== 'activity') return;
    let cancelled = false;
    setLoadingActivity(true);
    (async () => {
      try {
        const res = await api.get<{ success: boolean; data: SlackActivityItem[] }>(`/slack/activity`, {
          params: { orgId: currentOrg.id, limit: 60 },
        });
        if (cancelled) return;
        if (res.data.success) {
          const items = res.data.data || [];
          setActivity(items);
          // Keep last-seen timestamps warm
          items.forEach((it) => {
            if (it?.channelId && it?.ts) noteSeenTs(String(it.channelId), String(it.ts));
          });
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e?.response?.data?.message || 'Failed to load activity');
      } finally {
        if (!cancelled) setLoadingActivity(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, currentOrg?.id, viewMode, noteSeenTs]);

  // Fallback polling for unread counters + sound.
  // Needed because Slack only sends realtime events for channels where the app is a member.
  useEffect(() => {
    if (!configured || !currentOrg?.id) return;
    let stopped = false;
    const orgId = currentOrg.id;

    const tick = async () => {
      try {
        const res = await api.get<{ success: boolean; data: SlackActivityItem[] }>(`/slack/activity`, {
          params: { orgId, limit: 80 },
        });
        if (stopped) return;
        if (!res.data.success) return;
        const items = res.data.data || [];

        items.forEach((it) => {
          const ch = String(it?.channelId || '');
          const ts = String(it?.ts || '');
          if (!ch || !ts) return;

          const prevTs = lastSeenTsByChannelRef.current[ch];
          const prevN = Number(prevTs || 0);
          const nextN = Number(ts || 0);
          if (!Number.isFinite(nextN) || nextN <= 0) return;

          // First time we see a channel → set baseline, don't notify.
          if (!prevTs) {
            lastSeenTsByChannelRef.current[ch] = ts;
            return;
          }

          if (nextN > prevN) {
            // New activity detected.
            lastSeenTsByChannelRef.current[ch] = ts;

            const currentActive = activeChannelIdRef.current;
            const isActive = Boolean(currentActive && ch === currentActive);
            const shouldCountActiveAsUnread =
              viewModeRef.current !== 'channels' ||
              !stickToBottomRef.current ||
              (typeof document !== 'undefined' && document.visibilityState !== 'visible');

            if (!isActive || shouldCountActiveAsUnread) {
              setUnreadByChannel((prev) => ({ ...prev, [ch]: (prev[ch] || 0) + 1 }));
              playNotificationReceived();
            }
          }
        });
      } catch {
        // ignore
      }
    };

    const t = window.setInterval(() => {
      if (!stopped) tick();
    }, 15_000);
    tick();

    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [configured, currentOrg?.id]);

  useEffect(() => {
    if (!socket) return;
    const handler = (m: {
      orgId?: string;
      channelId: string;
      ts: string;
      text: string;
      user: string | null;
      userName?: string | null;
      userAvatar?: string | null;
      file?: { id: string; name: string; mimetype?: string } | null;
    }) => {
      if (currentOrg?.id && m.orgId && m.orgId !== currentOrg.id) return;
      const msg: SlackMessage = {
        channel: m.channelId,
        ts: m.ts,
        text: m.text || '',
        user: m.user || null,
        userName: m.userName ?? null,
        userAvatar: m.userAvatar ?? null,
        file: m.file || null,
      };
      noteSeenTs(String(m.channelId), String(m.ts));
      setMessages((prev) => {
        const arr = prev[m.channelId] ? [...prev[m.channelId]] : [];
        const isPlaceholderUpload =
          !msg.text &&
          Boolean(msg.file?.id) &&
          !msg.user &&
          !msg.userName &&
          !msg.userAvatar;
        const idx = arr.findIndex((x) => x.ts === msg.ts);
        // Special case: file uploads have a local ts on the optimistic event,
        // but Slack's realtime event uses a different ts. Match by Slack file id.
        const fileIdx =
          idx >= 0
            ? -1
            : msg.file?.id
              ? arr.findIndex((x) => x.file?.id && msg.file?.id && x.file.id === msg.file.id)
              : -1;
        // If we already have the real Slack event for this file, ignore the placeholder upload event.
        if (isPlaceholderUpload && fileIdx >= 0) return prev;
        // If we already have the message (optimistic append), merge identity/file fields from realtime.
        if (idx >= 0 || fileIdx >= 0) {
          const useIdx = idx >= 0 ? idx : fileIdx;
          const existing = arr[useIdx]!;
          const merged: SlackMessage = {
            ...existing,
            // prefer realtime values when present
            user: msg.user ?? existing.user,
            userName: msg.userName ?? existing.userName,
            userAvatar: msg.userAvatar ?? existing.userAvatar,
            file: msg.file ?? existing.file,
            text: msg.text || existing.text,
          };
          // no-op if nothing changed
          if (
            merged.user === existing.user &&
            merged.userName === existing.userName &&
            merged.userAvatar === existing.userAvatar &&
            merged.text === existing.text &&
            merged.file === existing.file
          ) {
            return prev;
          }
          arr[useIdx] = merged;
          return { ...prev, [m.channelId]: arr };
        }
        return { ...prev, [m.channelId]: [...arr, msg] };
      });

      // Unread badges for all channels:
      // - Always increment for channels that aren't currently open.
      // - For the active channel, increment only if user isn't at bottom / is on Activity view / tab isn't focused.
      const currentActive = activeChannelIdRef.current;
      const isActive = Boolean(currentActive && m.channelId === currentActive);
      const shouldCountActiveAsUnread =
        viewModeRef.current !== 'channels' ||
        !stickToBottomRef.current ||
        (typeof document !== 'undefined' && document.visibilityState !== 'visible');
      if (m.channelId && (!isActive || shouldCountActiveAsUnread)) {
        setUnreadByChannel((prev) => ({ ...prev, [m.channelId]: (prev[m.channelId] || 0) + 1 }));
        playNotificationReceived();
      }

      // If we got a Slack user id but no profile, resolve it (so UI doesn't show USER Uxxxx)
      if (msg.user && !msg.userName && currentOrg?.id) {
        const uid = msg.user;
        api
          .get<{ success: boolean; data: { id: string; name: string; avatar: string | null } }>(
            `/slack/users/${encodeURIComponent(uid)}/profile`,
            { params: { orgId: currentOrg.id } }
          )
          .then((res) => {
            const p = res?.data?.data;
            if (!p?.id) return;
            setSlackProfiles((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: { name: p.name, avatar: p.avatar } }));
            setMessages((prev) => {
              const arr = prev[m.channelId] ? [...prev[m.channelId]] : [];
              const next = arr.map((x) =>
                x.ts === msg.ts ? { ...x, userName: p.name, userAvatar: p.avatar } : x
              );
              return { ...prev, [m.channelId]: next };
            });
          })
          .catch(() => {});
      }
    };
    socket.on('slack:message', handler);
    return () => {
      socket.off('slack:message', handler);
    };
  }, [socket, currentOrg?.id, activeChannelId, noteSeenTs]);

  // Resolve missing Slack profiles for messages loaded on refresh
  useEffect(() => {
    if (!currentOrg?.id || !activeChannelId) return;
    const missing = Array.from(
      new Set(
        (activeMessages || [])
          .map((m) => m.user)
          .filter((u): u is string => Boolean(u) && !slackProfiles[String(u)] && !activeMessages.find((x) => x.user === u && x.userName))
      )
    ).slice(0, 10);
    if (missing.length === 0) return;
    missing.forEach((uid) => {
      api
        .get<{ success: boolean; data: { id: string; name: string; avatar: string | null } }>(
          `/slack/users/${encodeURIComponent(uid)}/profile`,
          { params: { orgId: currentOrg.id } }
        )
        .then((res) => {
          const p = res?.data?.data;
          if (!p?.id) return;
          setSlackProfiles((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: { name: p.name, avatar: p.avatar } }));
          setMessages((prev) => {
            const arr = prev[activeChannelId] ? [...prev[activeChannelId]] : [];
            const next = arr.map((x) => (x.user === p.id ? { ...x, userName: x.userName ?? p.name, userAvatar: x.userAvatar ?? p.avatar } : x));
            return { ...prev, [activeChannelId]: next };
          });
        })
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, currentOrg?.id, activeMessages.length, Object.keys(slackProfiles).length]);

  // Fetch image blobs for messages that contain files (parallelized for faster UX)
  useEffect(() => {
    if (!activeChannelId || !currentOrg?.id) return;
    const files = activeMessages.map((m) => m.file).filter(Boolean) as { id: string; name: string; mimetype?: string }[];
    const imageFiles = files.filter((f) => isImageFile(f));
    if (imageFiles.length === 0) return;

    let cancelled = false;
    (async () => {
      const pending = imageFiles.filter((f) => !fileBlobs[f.id] && !fileErrors[f.id]);
      if (pending.length === 0) return;

      const concurrency = 3;
      let idx = 0;

      const worker = async () => {
        while (!cancelled) {
          const f = pending[idx++];
          if (!f) return;
          try {
            const res = await api.get(`/slack/files/${encodeURIComponent(f.id)}`, {
              params: { orgId: currentOrg.id },
              responseType: 'blob',
            });
            if (cancelled) return;
            const url = URL.createObjectURL(res.data);
            setFileBlobs((prev) => ({ ...prev, [f.id]: url }));
          } catch (e: any) {
            if (cancelled) return;
            const msg = String(e?.response?.data?.message || e?.message || 'Failed to load image');
            setFileErrors((prev) => ({ ...prev, [f.id]: msg }));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, () => worker()));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannelId, currentOrg?.id, activeMessages.length]);

  const connectSlack = async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await api.get<{ success: boolean; data: { url: string } }>(`/slack/oauth/start`, { params: { orgId: currentOrg.id } });
      if (res.data.success && res.data.data.url) {
        const url = res.data.data.url;
        setConnectUrl(url);
        // Prefer opening in a browser tab (Windows sometimes tries to deep-link into Slack app).
        if (!openOAuthPopup(url)) {
          toast.error(
            'Popup blocked — the Slack link was copied. Paste it into your main browser (e.g. Chrome) where the correct Slack workspace is signed in.'
          );
        }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to start Slack connect');
    }
  };

  const connectSlackUser = async () => {
    if (!currentOrg?.id) return;
    try {
      const res = await api.get<{ success: boolean; data: { url: string } }>(`/slack/user/oauth/start`, { params: { orgId: currentOrg.id } });
      if (res.data.success && res.data.data.url) {
        const url = res.data.data.url;
        setConnectUserUrl(url);
        if (!openOAuthPopup(url)) {
          toast.error(
            'Popup blocked — the Slack link was copied. Paste it into your main browser (e.g. Chrome) where the correct Slack workspace is signed in.'
          );
        }
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to start Slack user connect');
    }
  };

  const createSlackChannel = async () => {
    if (!currentOrg?.id) return;
    const name = window.prompt('Create Slack channel (name):', '');
    if (!name || !name.trim()) return;
    try {
      const res = await api.post<{ success: boolean; data: { channelId: string; name: string } }>(`/slack/channels/create`, {
        orgId: currentOrg.id,
        name,
      });
      const newId = res?.data?.data?.channelId;
      if (newId) {
        const chRes = await api.get<{ success: boolean; data: SlackChannel[] }>(`/slack/channels`, { params: { orgId: currentOrg.id } });
        if (chRes.data.success) setChannels(chRes.data.data || []);
        setActiveChannelId(newId);
        try {
          if (slackLastChannelKey) window.localStorage.setItem(slackLastChannelKey, newId);
        } catch {}
      }
      toast.success(`Created #${res?.data?.data?.name || name}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to create channel');
    }
  };

  const openManageAccess = (channelId: string) => {
    setManageAccessChannelId(channelId);
    setManageSearch('');
    const existing = channelAccess?.[channelId] || [];
    const map: Record<string, boolean> = {};
    existing.forEach((id) => {
      map[String(id)] = true;
    });
    setManageSelected(map);
  };

  const saveManageAccess = async () => {
    if (!currentOrg?.id || !manageAccessChannelId) return;
    const userIds = Object.entries(manageSelected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    try {
      const res = await api.put<{ success: boolean; data: Record<string, string[]> }>(`/slack/channel-access`, {
        orgId: currentOrg.id,
        channelId: manageAccessChannelId,
        userIds,
      });
      if (res.data.success) setChannelAccess(res.data.data || {});
      toast.success('Channel access saved');
      setManageAccessChannelId(null);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Only admins can manage channel access');
    }
  };

  const send = async () => {
    if (!activeChannelId) return;
    const text = getEditorText().trim();
    const files = pendingUploads.map((p) => p.file);
    if (!text && files.length === 0) return;
    setDraft('');
    setMentionState(null);
    if (editorRef.current) editorRef.current.innerHTML = '';
    try {
      if (files.length > 0) {
        await uploadFilesNow(files);
        setPendingUploads((prev) => {
          prev.forEach((p) => {
            if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
          });
          return [];
        });
      }
      if (text) {
        const res = await api.post<{ success: boolean; data?: { ts?: string } }>(`/slack/channels/${activeChannelId}/message`, {
          text,
          orgId: currentOrg?.id,
        });
        const ts = res?.data?.data?.ts || String(Date.now());
        // Optimistic append so sender sees it instantly (even if websocket is delayed)
        setMessages((prev) => {
          const arr = prev[activeChannelId] ? [...prev[activeChannelId]] : [];
          if (arr.some((m) => m.ts === ts && m.text === text)) return prev;
          const optimisticName = currentUser ? `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() : '';
          return {
            ...prev,
            [activeChannelId]: [
              ...arr,
              {
                channel: activeChannelId,
                ts,
                text,
                user: null,
                userName: optimisticName || 'You',
                userAvatar: currentUser?.avatarUrl || null,
              },
            ],
          };
        });
      }
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to send';
      toast.error(msg);
      if (String(msg).toLowerCase().includes('not connected') || String(msg).toLowerCase().includes('reconnect slack')) {
        setConfigured(false);
        setChannels([]);
        setActiveChannelId(null);
        setMessages({});
      }
    }
  };

  const joinChannel = async (channelId: string) => {
    if (!currentOrg?.id) return;
    try {
      await api.post(`/slack/channels/${channelId}/join`, { orgId: currentOrg.id });
      // Reload channels list to update isMember
      const res = await api.get<{ success: boolean; data: SlackChannel[] }>(`/slack/channels`, { params: { orgId: currentOrg.id } });
      if (res.data.success) setChannels(res.data.data || []);
      const name = (res.data.data || []).find((c) => c.id === channelId)?.name || 'channel';
      toast.success(`Joined #${name}`);
    } catch (e: any) {
      const msg = e?.response?.data?.message || 'Failed to join channel';
      toast.error(msg);
      if (String(msg).toLowerCase().includes('not connected') || String(msg).toLowerCase().includes('reconnect slack')) {
        setConfigured(false);
        setChannels([]);
        setActiveChannelId(null);
        setMessages({});
      }
    }
  };

  useEffect(() => {
    // Clear pending attachments when switching channels
    setPendingUploads((prev) => {
      prev.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
      return [];
    });
  }, [activeChannelId]);

  const addPendingFiles = (files: FileList | File[]) => {
    if (!activeChannelId || !currentOrg?.id) {
      toast.error('Select a channel first');
      return;
    }
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setPendingUploads((prev) => [
      ...prev,
      ...arr.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        previewUrl: file.type?.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      })),
    ]);
  };

  const removePendingUpload = (id: string) => {
    setPendingUploads((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const uploadFilesNow = async (files: FileList | File[]) => {
    if (!activeChannelId || !currentOrg?.id) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setUploadingNow(true);
    try {
      for (const file of arr) {
        const fd = new FormData();
        fd.append('file', file, file.name);
        fd.append('clientFilename', file.name);
        fd.append('orgId', currentOrg.id);
        const res = await api.post(`/slack/channels/${activeChannelId}/file`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        if (!res?.data?.success) throw new Error('File upload failed');
      }
    } finally {
      setUploadingNow(false);
    }
  };

  if (!currentOrg?.id) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] p-6">
        <Loading size="lg" text="Loading workspace…" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="p-6">
        <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6">
          <h1 className="text-lg font-black text-gray-900 dark:text-white mb-2">Slack Channels</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Connect Slack to show channels inside your website.
          </p>
          <div className="mt-4">
            <button
              onClick={connectSlack}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black"
            >
              Connect Slack
            </button>
            {connectUrl && (
              <div className="mt-3 text-sm">
                <div className="text-gray-500 dark:text-gray-400 text-xs font-bold uppercase tracking-widest">
                  If Slack app opens, use this browser link
                </div>
                <div className="mt-2 flex flex-col gap-2">
                <a
                  href={connectUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-1 text-indigo-600 dark:text-indigo-400 font-black hover:underline break-all"
                >
                  Open Slack authorization in browser
                </a>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(connectUrl);
                        toast.success('Copied Slack authorization link');
                      } catch {
                        toast.error('Copy failed. Please select the link and copy.');
                      }
                    }}
                    className="self-start px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-200 text-xs font-black hover:bg-gray-50 dark:hover:bg-gray-900"
                  >
                    Copy browser link
                  </button>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    Tip: when your browser asks “Open Slack?”, click <b>Cancel</b> / <b>Continue in browser</b>.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="-m-4 sm:-m-6 h-[calc(100vh-3.5rem)] bg-white dark:bg-[#0F172A] flex overflow-hidden">
      {manageAccessChannelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <div className="text-sm font-black text-gray-900 dark:text-gray-100">
                Channel members access
              </div>
              <button
                type="button"
                onClick={() => setManageAccessChannelId(null)}
                className="h-9 w-9 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-500 dark:text-gray-300 font-black"
                title="Close"
              >
                ×
              </button>
            </div>
            <div className="p-3 border-b border-gray-100 dark:border-gray-800">
              <input
                value={manageSearch}
                onChange={(e) => setManageSearch(e.target.value)}
                placeholder="Search member…"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 text-sm outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
            <div className="max-h-[280px] overflow-y-auto p-3 space-y-2">
              {mentionCandidates
                .filter((m) => {
                  const q = manageSearch.trim().toLowerCase();
                  if (!q) return true;
                  const name = `${m.firstName} ${m.lastName}`.trim().toLowerCase();
                  const email = (m.email || '').toLowerCase();
                  return name.includes(q) || email.includes(q);
                })
                .map((m) => {
                  const label = `${m.firstName} ${m.lastName}`.trim() || m.email || m.id;
                  return (
                    <label
                      key={m.id}
                      className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(manageSelected[m.id])}
                        onChange={(e) => setManageSelected((prev) => ({ ...prev, [m.id]: e.target.checked }))}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{label}</div>
                        {m.email && (
                          <div className="text-[11px] font-bold text-gray-500 dark:text-gray-400 truncate">{m.email}</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              {mentionCandidates.filter((m) => {
                const q = manageSearch.trim().toLowerCase();
                if (!q) return true;
                const name = `${m.firstName} ${m.lastName}`.trim().toLowerCase();
                const email = (m.email || '').toLowerCase();
                return name.includes(q) || email.includes(q);
              }).length === 0 && (
                <div className="text-sm text-gray-500 dark:text-gray-400">No members found.</div>
              )}
            </div>
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setManageAccessChannelId(null)}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-800 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveManageAccess}
                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {isSlackAdmin && (
      <div className="w-72 border-r border-gray-100 dark:border-gray-800 p-3 overflow-y-auto mt-[23px] mx-[22px]">
        <div className="px-2 pb-2">
          <div className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-1">
            <button
              type="button"
              onClick={() => setViewMode('activity')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-black ${
                viewMode === 'activity'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              Activity
            </button>
            <button
              type="button"
              onClick={() => setViewMode('channels')}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-black ${
                viewMode === 'channels'
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60'
              }`}
            >
              Channels
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Slack Channels</div>
          <div className="relative" ref={channelsMenuRef}>
            <button
              type="button"
              onClick={() => setChannelsMenuOpen((v) => !v)}
              className="h-8 w-8 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-500 dark:text-gray-300 font-black"
              title="Channels options"
            >
              …
            </button>
            {channelsMenuOpen && (
              <div className="absolute right-0 mt-1 z-20 w-64 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => {
                    setShowAllChannels(false);
                    setChannelsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm font-bold ${
                    !showAllChannels ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100' : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  Member only (Joined channels)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAllChannels(true);
                    setChannelsMenuOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm font-bold ${
                    showAllChannels ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100' : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                  }`}
                >
                  All channels
                </button>
                <div className="h-px bg-gray-100 dark:bg-gray-800" />
                <button
                  type="button"
                  onClick={() => {
                    setChannelsMenuOpen(false);
                    createSlackChannel();
                  }}
                  className="w-full text-left px-3 py-2 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  Create channel…
                </button>
              </div>
            )}
          </div>
        </div>
        {viewMode === 'activity' ? (
          <div className="space-y-2 px-2 pb-2">
            {loadingActivity && (
              <div className="py-6 text-center text-[11px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">
                Loading activity…
              </div>
            )}
            {!loadingActivity && activity.length === 0 && (
              <div className="py-6 text-center text-sm font-bold text-gray-600 dark:text-gray-400">
                No recent activity.
              </div>
            )}
            {!loadingActivity &&
              activity.map((a) => (
                <button
                  key={`${a.channelId}:${a.ts}`}
                  type="button"
                  onClick={() => {
                    setActiveChannelId(a.channelId);
                    setViewMode('channels');
                    setUnreadByChannel((prev) => {
                      if (!prev?.[a.channelId]) return prev;
                      const { [a.channelId]: _drop, ...rest } = prev;
                      return rest;
                    });
                    try {
                      if (slackLastChannelKey) window.localStorage.setItem(slackLastChannelKey, a.channelId);
                    } catch {}
                  }}
                  className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-gray-900 dark:text-gray-100 truncate">
                      <span className="text-gray-400 mr-1">#</span>
                      {a.channelName || 'channel'}
                    </div>
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest shrink-0">
                      {formatSlackTs(a.ts)}
                    </div>
                  </div>
                  <div className="mt-1 text-[12px] font-bold text-gray-700 dark:text-gray-200 line-clamp-2 break-words">
                    {a.file?.name ? `📎 ${a.file.name}` : a.text || '…'}
                  </div>
                </button>
              ))}
          </div>
        ) : (
        <div className="space-y-1">
          {visibleChannels.map((c) => {
            const active = c.id === activeChannelId;
            return (
              <div key={c.id} className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setActiveChannelId(c.id);
                    setUnreadByChannel((prev) => {
                      if (!prev?.[c.id]) return prev;
                      const { [c.id]: _drop, ...rest } = prev;
                      return rest;
                    });
                    // Persist immediately so reload keeps this channel (even if other requests refetch channels).
                    try {
                      if (slackLastChannelKey) window.localStorage.setItem(slackLastChannelKey, c.id);
                    } catch {
                      /* ignore */
                    }
                  }}
                  className={`flex-1 text-left px-3 py-2 rounded-xl text-[13px] font-bold transition-colors ${
                    active ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <span className="text-gray-400 mr-1">#</span>
                  {c.name}
                  {unreadByChannel[c.id] ? (
                    <span className="ml-2 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-black align-middle">
                      {unreadByChannel[c.id] > 99 ? '99+' : unreadByChannel[c.id]}
                    </span>
                  ) : null}
                </button>
                <div className="relative" ref={channelRowMenuId === c.id ? channelRowMenuRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setChannelRowMenuId((prev) => (prev === c.id ? null : c.id))}
                    className="h-9 w-9 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-500 dark:text-gray-300 font-black"
                    title="Channel actions"
                  >
                    …
                  </button>
                  {channelRowMenuId === c.id && (
                    <div className="absolute right-0 mt-1 z-20 w-48 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">
                      <button
                        type="button"
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => {
                          setChannelRowMenuId(null);
                          openManageAccess(c.id);
                        }}
                        className="w-full text-left px-3 py-2 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      >
                        Member access…
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            if (slackLastChannelKey) window.localStorage.setItem(slackLastChannelKey, c.id);
                            toast.success(`Default channel set to #${c.name}`);
                          } catch {
                            toast.error('Failed to save default channel');
                          } finally {
                            setChannelRowMenuId(null);
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      >
                        Set as default
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(`#${c.name}`);
                            toast.success('Copied channel name');
                          } catch {
                            toast.error('Copy failed');
                          } finally {
                            setChannelRowMenuId(null);
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      >
                        Copy name
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(c.id);
                            toast.success('Copied channel id');
                          } catch {
                            toast.error('Copy failed');
                          } finally {
                            setChannelRowMenuId(null);
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                      >
                        Copy channel id
                      </button>
                      {showAllChannels && c.isMember === false && (
                        <>
                          <div className="h-px bg-gray-100 dark:bg-gray-800" />
                          <button
                            type="button"
                            onClick={() => {
                              setChannelRowMenuId(null);
                              joinChannel(c.id);
                            }}
                            className="w-full text-left px-3 py-2 text-sm font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30"
                          >
                            Join channel
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {showAllChannels && c.isMember === false && (
                  <button
                    onClick={() => joinChannel(c.id)}
                    className="px-2 py-2 rounded-xl text-[11px] font-black bg-indigo-600 hover:bg-indigo-700 text-white"
                    title="Join channel"
                  >
                    Join
                  </button>
                )}
              </div>
            );
          })}
        </div>
        )}
      </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 mx-[25px]">
        {!userConnected && !hideSlackIdentityBanner && (
          <div className="mx-5 mt-5 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-amber-900 dark:text-amber-200 truncate">Connect your Slack identity</div>
                <div className="text-xs font-bold text-amber-700/80 dark:text-amber-300/80">
                  This makes messages appear in Slack as your real Slack user (name + avatar).
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    try {
                      window.localStorage.setItem(slackIdentityBannerKey, '1');
                    } catch {}
                    setHideSlackIdentityBanner(true);
                  }}
                  className="px-2 py-2 rounded-xl border border-amber-300/60 dark:border-amber-800/60 text-[11px] font-black text-amber-900 dark:text-amber-200 hover:bg-amber-100/60 dark:hover:bg-amber-900/20"
                >
                  Hide
                </button>
                <button
                  onClick={connectSlackUser}
                  className="px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-black"
                >
                  Connect
                </button>
              </div>
            </div>
            {connectUserUrl && (
              <a
                href={connectUserUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[12px] font-black text-amber-700 dark:text-amber-300 hover:underline break-all"
              >
                Open in browser
              </a>
            )}
          </div>
        )}
        {!userConnected && hideSlackIdentityBanner && (
          <div className="mx-5 mt-5 flex items-center justify-end">
            <button
              type="button"
              onClick={connectSlackUser}
              className="px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 text-amber-900 dark:text-amber-200 text-xs font-black hover:bg-amber-100/70 dark:hover:bg-amber-900/20"
              title="Connect Slack identity"
            >
              Connect Slack identity
            </button>
          </div>
        )}
        {userConnected && showIdentityLinkedBanner && (
          <div className="mx-5 mt-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/10 px-4 py-2.5">
            <div className="text-xs font-black text-emerald-900 dark:text-emerald-200">
              Slack identity connected — messages post as your Slack user in this workspace.
            </div>
          </div>
        )}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 my-5">
          <div className="text-sm font-black text-gray-900 dark:text-white">
            {activeChannelId ? `#${channels.find((c) => c.id === activeChannelId)?.name || 'channel'}` : 'Select a channel'}
          </div>
        </div>

        <div
          ref={listRef}
          onScroll={() => setStickToBottom(isNearBottom())}
          className="flex-1 overflow-y-auto p-5 space-y-3"
        >
          {loadingMessages && (
            <div className="py-10 flex items-center justify-center">
              <div className="text-xs font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest">Loading messages…</div>
            </div>
          )}

          {!loadingMessages && activeChannelId && activeMessages.length === 0 && (
            <div className="py-10 flex items-center justify-center">
              <div className="max-w-md text-center">
                <div className="text-sm font-black text-gray-900 dark:text-gray-100">No messages to show</div>
                <div className="mt-1 text-xs font-bold text-gray-600 dark:text-gray-400">
                  If this channel has messages in Slack but shows empty here, make sure the Slack app (or your Slack identity) is invited to the channel, then refresh.
                </div>
              </div>
            </div>
          )}

          {activeMessages.map((m) => (
            <SlackMessageItem
              key={m.ts}
              m={m}
              slackProfiles={slackProfiles}
              brokenAvatars={brokenAvatars}
              onAvatarError={handleAvatarError}
              fileBlobs={fileBlobs}
              fileErrors={fileErrors}
              orgId={currentOrg?.id || ''}
            />
          ))}
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 p-4 mx-5">
          <input
            ref={fileInputRef}
            type="file"
            title="Upload file to Slack"
            aria-label="Upload file to Slack"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) addPendingFiles(e.target.files);
              e.currentTarget.value = '';
            }}
          />

          {pendingUploads.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingUploads.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2 py-2"
                >
                  {p.previewUrl ? (
                    <img src={p.previewUrl} alt="" className="h-10 w-10 rounded-xl object-cover border border-gray-200 dark:border-gray-800" />
                  ) : (
                    <div className="h-10 w-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-[10px] font-black text-indigo-700 dark:text-indigo-300">
                      FILE
                    </div>
                  )}
                  <div className="max-w-[200px]">
                    <div className="text-xs font-black text-gray-900 dark:text-gray-100 truncate">{p.file.name}</div>
                    <div className="text-[11px] font-bold text-gray-400 dark:text-gray-500">Ready to send</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePendingUpload(p.id)}
                    className="h-8 w-8 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300 font-black"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setComposerDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setComposerDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setComposerDragOver(false);
              if (e.dataTransfer.files?.length) addPendingFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl transition-colors ${composerDragOver ? 'ring-2 ring-indigo-500/50 bg-indigo-50/50 dark:bg-indigo-950/20' : ''}`}
          >
            <div className="flex gap-2 items-end">
              <div className="flex-1 min-w-0 relative">
                {mentionState && filteredMentionMembers.length > 0 && (
                  <ul className="absolute bottom-full left-0 right-0 mb-1 z-20 max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1">
                    {filteredMentionMembers.map((mem, idx) => (
                      <li key={mem.id}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickMentionMember(mem)}
                          className={`w-full text-left px-3 py-2 text-sm font-bold ${
                            idx === mentionHighlight ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-900 dark:text-indigo-100' : 'text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60'
                          }`}
                        >
                          <span className="font-black">{`${mem.firstName} ${mem.lastName}`.trim() || 'Member'}</span>
                          {mem.email && <span className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 truncate">{mem.email}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mx-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
                  {showFormatBar && (
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-gray-100 dark:border-gray-800">
                    <div className="-m-1 p-1 rounded-md flex items-center gap-1 hover:bg-gray-100/80 dark:hover:bg-gray-800/60 transition-colors">
                      <button
                        type="button"
                        className="chat-toolbar-btn"
                        title="Bold"
                        onClick={() => {
                          execFormat('bold');
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M7 5h7a4 4 0 010 8H7V5z" stroke="currentColor" strokeWidth="2" />
                          <path d="M7 13h8a4 4 0 010 8H7v-8z" stroke="currentColor" strokeWidth="2" />
                        </svg>
                      </button>
                      <button type="button" className="chat-toolbar-btn" title="Italic" onClick={() => execFormat('italic')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M10 5h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M4 19h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M14 5l-4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button type="button" className="chat-toolbar-btn" title="Strikethrough" onClick={() => execFormat('strikeThrough')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M8 7c1-1 2.4-2 4.5-2C16 5 18 6.5 18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M6 15c0 2 2.2 4 6 4 3.2 0 5-1.2 6-2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="chat-toolbar-btn"
                        title="Code"
                        onClick={() =>
                          execFormat(
                            'insertHTML',
                            '<code style="background:#f1f1f1;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:13px">code</code>'
                          )
                        }
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M8 16l-4-4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M16 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M14 4l-4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button type="button" className="chat-toolbar-btn" title="Quote" onClick={() => execFormat('formatBlock', 'blockquote')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M7 10h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M7 6h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M7 14h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M7 18h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button type="button" className="chat-toolbar-btn" title="Bullet list" onClick={() => execFormat('insertUnorderedList')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M9 6h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M9 12h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M9 18h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M5 6h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                          <path d="M5 12h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                          <path d="M5 18h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="chat-toolbar-btn"
                        title="Link"
                        onClick={() => {
                          const url = window.prompt('Enter URL:', '');
                          if (!url) return;
                          execFormat('createLink', url);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M10 13a5 5 0 007 0l1-1a5 5 0 00-7-7l-1 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M14 11a5 5 0 00-7 0l-1 1a5 5 0 007 7l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" className="chat-toolbar-btn" title="Emoji" onClick={() => insertTextAtCursor('🙂')}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22a10 10 0 100-20 10 10 0 000 20z" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 15s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M9 10h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                          <path d="M15 10h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  )}
                  <div
                  ref={editorRef}
                  contentEditable={Boolean(activeChannelId && !uploadingNow)}
                  suppressContentEditableWarning
                  onInput={syncMentionFromCursor}
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (mentionState && filteredMentionMembers.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionHighlight((i) => Math.min(i + 1, filteredMentionMembers.length - 1));
                        return;
                      }
                      if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionHighlight((i) => Math.max(i - 1, 0));
                        return;
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        pickMentionMember(filteredMentionMembers[mentionHighlight]!);
                        return;
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setMentionState(null);
                        return;
                      }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  onKeyUp={syncMentionFromCursor}
                  onClick={syncMentionFromCursor}
                  data-placeholder={activeChannelId ? 'Message Slack… (@ to mention)' : 'Select a channel to message'}
                  className="chat-rich-editor min-h-[50px] max-h-[140px] overflow-y-auto px-3 py-2 text-sm leading-[22px] text-gray-900 dark:text-gray-100 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 dark:empty:before:text-gray-500 empty:before:pointer-events-none disabled:opacity-50"
                />
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center gap-1" ref={attachMenuRef}>
                      <button
                        type="button"
                        disabled={!activeChannelId || uploadingNow}
                        onClick={() => setAttachMenuOpen((o) => !o)}
                        className="h-8 w-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                        title="Add"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M12 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={!activeChannelId || uploadingNow}
                        onClick={() => setShowFormatBar((s) => !s)}
                        className="h-8 w-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                        title="Formatting"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M4.5 18.5V5.5h6.1c2.5 0 4.4 1.7 4.4 4 0 2.4-1.9 4-4.4 4H7v5h-2.5zm2.5-7h3.4c1.1 0 1.9-.8 1.9-2s-.8-2-1.9-2H7v4z"
                            fill="currentColor"
                          />
                          <path
                            d="M20 18.7c-1.8 0-3.2-1.1-3.2-2.9 0-1.9 1.6-2.8 3.6-3.1l2.1-.3V12c0-.8-.5-1.4-1.6-1.4-1 0-1.6.6-1.7 1.4h-2.2c.1-2 1.7-3.4 4-3.4 2.4 0 3.9 1.2 3.9 3.4v6.6h-2.1v-1.2c-.4.7-1.3 1.4-2.8 1.4zm.6-1.8c1.2 0 2-.8 2-2v-.9l-1.7.3c-1.1.2-1.8.6-1.8 1.4 0 .8.6 1.2 1.5 1.2z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={!activeChannelId || uploadingNow}
                        onClick={() => {
                          fileInputRef.current?.click();
                          setAttachMenuOpen(false);
                        }}
                        className="h-8 w-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                        title="Attach"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M21 11.5l-8.5 8.5a6 6 0 01-8.5-8.5l9.2-9.2a4 4 0 015.7 5.7l-9.2 9.2a2 2 0 01-2.8-2.8L15.5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={!activeChannelId || uploadingNow}
                        onClick={() => {
                          insertTextAtCursor('@');
                          setAttachMenuOpen(false);
                        }}
                        className="h-8 w-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                        title="Mention"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M12 3.5a8.5 8.5 0 108.5 8.5V12c0 2.8-1.8 4.5-4 4.5-1.1 0-1.8-.5-2.1-1.3-.6.9-1.6 1.4-2.9 1.4-2.2 0-3.9-1.7-3.9-4.3 0-2.7 1.8-4.5 4.4-4.5 1.2 0 2.2.4 2.8 1.1l.1-.9h2.1v6.1c0 1 .4 1.5 1.2 1.5 1.1 0 1.9-1.2 1.9-3.1 0-4.8-3.5-8.1-8.2-8.1-4.8 0-8.3 3.6-8.3 8.6 0 5 3.5 8.6 8.4 8.6 1.7 0 3.3-.4 4.7-1.2l.8 1.8c-1.7 1-3.6 1.5-5.6 1.5-6 0-10.6-4.4-10.6-10.7C1.4 7.8 6 3.5 12 3.5zm-.2 11.3c1.4 0 2.4-1.1 2.4-2.7 0-1.7-1-2.7-2.4-2.7-1.4 0-2.4 1.1-2.4 2.7 0 1.7 1 2.7 2.4 2.7z"
                            fill="currentColor"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={!activeChannelId || uploadingNow}
                        onClick={() => insertTextAtCursor('🙂')}
                        className="h-8 w-8 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                        title="Emoji"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                          <path d="M12 22a10 10 0 100-20 10 10 0 000 20z" stroke="currentColor" strokeWidth="2" />
                          <path d="M8 15s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                          <path d="M9 10h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                          <path d="M15 10h.01" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                        </svg>
                      </button>

                      {attachMenuOpen && (
                        <div className="absolute bottom-full left-0 mb-1 z-20 min-w-[200px] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg py-1">
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2.5 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                            onClick={() => {
                              fileInputRef.current?.click();
                              setAttachMenuOpen(false);
                            }}
                          >
                            Attach file…
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2.5 text-sm font-bold text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60"
                            onClick={() => {
                              insertTextAtCursor('@');
                              setAttachMenuOpen(false);
                            }}
                          >
                            Mention someone…
                          </button>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={send}
                      disabled={!activeChannelId || uploadingNow || (!draft.trim() && pendingUploads.length === 0)}
                      className="h-9 w-14 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black flex items-center justify-center"
                      title="Send"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                        <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-1.5 text-[11px] font-bold text-gray-400 dark:text-gray-500 px-1">
              Attach image/file first, then press <span className="text-gray-600 dark:text-gray-400">Send</span> to upload.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

