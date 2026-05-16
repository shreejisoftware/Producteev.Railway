import React, { useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import api from '../../services/api';
import { batchRequests } from '../../services/requestManager';
import { Loading } from '../../components/ui/Loading';
import { useOrgRole } from '../../hooks/useOrgRole';
import { TimeTracker } from '../../components/time-tracking/TimeTracker';
import { TimeEntryList } from '../../components/time-tracking/TimeEntryList';
import { ActivityItem } from '../../components/activity/ActivityItem';
import { AttachmentSection, type AttachmentSectionHandle } from '../../components/attachments/AttachmentSection';
import { TagPicker } from '../../components/tasks/TagPicker';
import { TaskDescriptionEditor } from '../../components/ui/TaskDescriptionEditor';
import { useNotifications } from '../../hooks/useNotifications';
import { useSocket } from '../../hooks/useSocket';
import { useAppSelector } from '../../store';
import { cn } from '../../utils/cn';
import { getUploadUrl, resolveAssetUrl } from '../../utils/assetUrl';
import { linkifyHtmlText, generateId, splitPlainTextWithUrls } from '../../utils/text';
import type { Task, TaskStatus, TaskPriority, Tag } from '../../types';
import { AvatarStack } from '../../components/ui/AvatarStack';
import { ImagePreview } from '../../components/attachments/ImagePreview';
import DatePickerPopup from '../../components/common/DatePickerPopup';
import { ConfirmDialog } from '../../components/modals/ConfirmDialog';
import { isStructuredCommentText, parseCommentDoc, CommentText, CommentFilePreview, CommentStructuredBody, CommentDocV1, CommentDocSegment, PendingCommentFile, CommentDraftBlock, PE_COMMENT_DOC_PREFIX } from '../../components/activity/CommentContent';

function initials(firstName?: string | null, lastName?: string | null) {
  const f = (firstName || '').trim();
  const l = (lastName || '').trim();
  const a = f ? f[0] : '?';
  const b = l ? l[0] : '';
  return `${a}${b}`.toUpperCase();
}

function UserAvatar({
  user,
  className,
  fallbackClassName,
}: {
  user: { firstName: string; lastName: string; avatarUrl?: string | null };
  className: string;
  fallbackClassName: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = resolveAssetUrl((user.avatarUrl || '').trim());

  if (!url || broken) {
    return (
      <div className={fallbackClassName} aria-label={`${user.firstName} ${user.lastName}`}>
        {initials(user.firstName, user.lastName)}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={className}
      onError={() => setBroken(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        // Some providers return a 1x1 "blank" image as a default.
        if (img.naturalWidth <= 1 && img.naturalHeight <= 1) setBroken(true);
      }}
    />
  );
}

/* ── Configs ── */
// 8 display statuses shown in UI
const DISPLAY_STATUSES = [
  { key: 'OPEN', label: 'OPEN', color: '#94a3b8', backendStatus: 'OPEN' as TaskStatus, section: 'statuses', type: 'dashed', bg: '#F1F5F8', textColor: '#3E4C59' },
  { key: 'PENDING', label: 'PENDING', color: '#f59e0b', backendStatus: 'PENDING' as TaskStatus, section: 'statuses', type: 'ring', bg: '#FADB5E', textColor: '#243B53' },
  { key: 'IN_PROGRESS', label: 'IN PROGRESS', color: '#cb1d63', backendStatus: 'IN_PROGRESS' as TaskStatus, section: 'statuses', type: 'ring', bg: '#cb1d63', textColor: '#ffffff' },
  { key: 'COMPLETED', label: 'COMPLETED', color: '#000000', backendStatus: 'COMPLETED' as TaskStatus, section: 'statuses', type: 'ring', bg: '#000000', textColor: '#ffffff' },
  { key: 'IN_REVIEW', label: 'IN REVIEW', color: '#f97316', backendStatus: 'IN_REVIEW' as TaskStatus, section: 'statuses', type: 'ring', bg: '#EA580C', textColor: '#ffffff' },
  { key: 'ACCEPTED', label: 'ACCEPTED', color: '#ef4444', backendStatus: 'ACCEPTED' as TaskStatus, section: 'statuses', type: 'ring', bg: '#C5221F', textColor: '#ffffff' },
  { key: 'REJECTED', label: 'REJECTED', color: '#8b5cf6', backendStatus: 'REJECTED' as TaskStatus, section: 'statuses', type: 'ring', bg: '#9C27B0', textColor: '#ffffff' },
  { key: 'CLOSED', label: 'CLOSED', color: '#10b981', backendStatus: 'CLOSED' as TaskStatus, section: 'closed', type: 'check', bg: '#10b981', textColor: '#ffffff' },
];

// Map backend TaskStatus -> default display status key
function backendToDisplay(s: TaskStatus): string {
  return s;
}

const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  URGENT: { label: 'Urgent', color: '#ef4444' },
  HIGH: { label: 'High', color: '#f97316' },
  MEDIUM: { label: 'Medium', color: '#eab308' },
  LOW: { label: 'Low', color: '#6b7280' },
};

/* ── Task Types (ClickUp-style) ──
 * Persisted per-task in localStorage so the choice survives refresh.
 * (Not yet stored in DB — easy to migrate to a `taskType` Prisma column later.)
 */
type TaskTypeKey = 'TASK' | 'MILESTONE' | 'FORM_RESPONSE' | 'LEAD' | 'MEETING_NOTE';
interface TaskTypeMeta {
  key: TaskTypeKey;
  label: string;
  colorClass: string; // dot color class
  icon: string;  // emoji glyph
}
const TASK_TYPES: TaskTypeMeta[] = [
  { key: 'TASK',          label: 'Task',          colorClass: 'bg-green-500', icon: '◉' },
  { key: 'MILESTONE',     label: 'Milestone',     colorClass: 'bg-sky-500', icon: '◈' },
  { key: 'FORM_RESPONSE', label: 'Form Response', colorClass: 'bg-purple-500', icon: '▤' },
  { key: 'LEAD',          label: 'Lead',          colorClass: 'bg-amber-500', icon: '☆' },
  { key: 'MEETING_NOTE',  label: 'Meeting Note',  colorClass: 'bg-pink-500', icon: '✎' },
];
const TASK_TYPE_STORAGE_KEY = (taskId: string) => `task_type:${taskId}`;
function loadTaskType(taskId: string): TaskTypeKey {
  try {
    const v = localStorage.getItem(TASK_TYPE_STORAGE_KEY(taskId));
    if (v && TASK_TYPES.some(t => t.key === v)) return v as TaskTypeKey;
  } catch { /* noop */ }
  return 'TASK';
}
function saveTaskType(taskId: string, key: TaskTypeKey) {
  try { localStorage.setItem(TASK_TYPE_STORAGE_KEY(taskId), key); } catch { /* noop */ }
}

/* ── Task layout (modal/fullscreen/sidebar), persisted globally ── */
type TaskLayout = 'modal' | 'fullscreen' | 'sidebar';
const TASK_LAYOUT_STORAGE_KEY = 'task_layout';
function loadTaskLayout(): TaskLayout {
  try {
    const v = localStorage.getItem(TASK_LAYOUT_STORAGE_KEY);
    if (v === 'modal' || v === 'fullscreen' || v === 'sidebar') return v;
  } catch { /* noop */ }
  return 'modal';
}
function saveTaskLayout(layout: TaskLayout) {
  try { localStorage.setItem(TASK_LAYOUT_STORAGE_KEY, layout); } catch { /* noop */ }
}

/* ── Helpers ── */
function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function relativeDueDate(dateStr: string | null): { text: string; overdue: boolean } {
  if (!dateStr) return { text: 'No date', overdue: false };
  const date = new Date(dateStr);
  const now = new Date();

  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  const day = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const yr = date.getFullYear();
  let text = `${day}/${m}/${yr}`;

  if (diffDays === 0) text = 'Today';
  else if (diffDays === -1) text = 'Tomorrow';
  else if (diffDays === 1) text = 'Yesterday';

  const hrs = date.getHours();
  const mins = date.getMinutes();
  if (hrs !== 0 || mins !== 0) {
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    const h12 = hrs % 12 || 12;
    const minStr = String(mins).padStart(2, '0');
    text += ` ${h12}:${minStr} ${ampm}`;
  }

  return { text, overdue: diffDays > 0 };
}

/* ── Date picker now provided by shared component (components/common/DatePickerPopup.tsx) ── */


/* ── Inline SVG icons ── */
function IconStatus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function IconFlag({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill={color}>
      <path d="M4 3a1 1 0 00-1 1v13a1 1 0 102 0v-5h4.586l.707.707A1 1 0 0011 13h5a1 1 0 001-1V5a1 1 0 00-1-1h-4.586l-.707-.707A1 1 0 0010 3H4z" />
    </svg>
  );
}
function IconTag() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" /><circle cx="7" cy="7" r="1" />
    </svg>
  );
}
function IconLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  );
}
function IconHourglass() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 017 17.828V22M17 2v4.172a2 2 0 01-.586 1.414L12 12l-4.414-4.414A2 2 0 017 6.172V2" />
    </svg>
  );
}

function StatusIcon({ s, className }: { s: any; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      if (s.type === 'check') {
        ref.current.style.backgroundColor = s.color;
      } else if (s.type === 'ring') {
        ref.current.style.borderColor = s.color;
      }
    }
    if (innerRef.current) {
      innerRef.current.style.backgroundColor = s.color;
    }
  }, [s.color, s.type]);

  if (s.type === 'dashed') {
    return (
      <div className={cn("w-4 h-4 rounded-full border-2 border-dashed border-gray-300 dark:border-gray-600 shrink-0", className)} />
    );
  }
  if (s.type === 'check') {
    return (
      <div
        ref={ref}
        className={cn("w-4 h-4 rounded-full flex items-center justify-center shrink-0", className)}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4"><path d="M20 6L9 17l-5-5" /></svg>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0", className)}
    >
      <div ref={innerRef} className="w-1.5 h-1.5 rounded-full" />
    </div>
  );
}

function StatusBadge({ ds, onClick, canUpdate, onMarkDone, onNextStatus }: { ds: any; onClick: () => void; canUpdate: boolean; onMarkDone?: () => void; onNextStatus?: () => void }) {
  const isClosed = ds.key === 'CLOSED';
  const badgeRef = useRef<any>(null);

  useEffect(() => {
    if (badgeRef.current) {
      badgeRef.current.style.backgroundColor = ds.bg;
      badgeRef.current.style.color = ds.textColor;
    }
  }, [ds.bg, ds.textColor]);

  if (isClosed) {
    return (
      <button
        ref={badgeRef}
        onClick={onClick}
        disabled={!canUpdate}
        className={cn(
          "h-7 flex font-black tracking-tight rounded-md px-3 items-center text-[10px] uppercase transition-all active:scale-[0.98]",
          !canUpdate ? "opacity-70 cursor-not-allowed" : "hover:brightness-105 shadow-sm"
        )}
        title="Open status menu"
      >
        {ds.label}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {/* Main Split Pill */}
      <div
        ref={badgeRef}
        className={cn(
          "h-7 flex font-black tracking-tight rounded-md overflow-hidden border border-black/5 transition-all text-gray-700",
          !canUpdate ? "opacity-70 cursor-not-allowed" : "shadow-sm"
        )}
      >
        <button
          onClick={onClick}
          disabled={!canUpdate}
          className="px-3 flex items-center text-[10px] font-black uppercase tracking-tight hover:bg-black/5 transition-colors active:bg-black/10"
          title="Open status menu"
        >
          {ds.label}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onNextStatus?.(); }}
          disabled={!canUpdate}
          className="w-6 flex items-center justify-center border-l bg-black/5 border-black/5 hover:bg-black/15 transition-colors active:bg-black/20"
          title="Next status"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      {/* Done Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onMarkDone?.(); }}
        disabled={!canUpdate}
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-md border bg-gray-100/80 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-600 transition-all active:scale-[0.98]"
        )}
        title="Mark as done"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5">
          <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

function StatusOption({ s, isSelected }: { s: any; isSelected?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <StatusIcon s={s} />
      <span className={cn(
        "text-[13px] uppercase tracking-tight text-gray-700 dark:text-gray-200",
        isSelected ? "font-black" : "font-medium"
      )}>
        {s.label}
      </span>
    </div>
  );
}

function IconTrackTime() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><path d="M12 6v6" /><path d="M16.24 16.24l-4.24-4.24" />
    </svg>
  );
}

/* ── Comment toolbar icons ── */
function IconSend() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>;
}
function IconPaperclip() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>;
}
function IconImagePlus() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  );
}
function IconPencilSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/* ── Checklist item type ── */
interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}
interface Checklist {
  id: string;
  name: string;
  items: ChecklistItem[];
}

/* ── Subtask type (local) ── */
interface Subtask {
  id: string;
  title: string;
  status: TaskStatus;
}

/* ── Comment type (from backend) ── */
interface CommentAttachment {
  fileUrl: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface Comment {
  id: string;
  text: string;
  taskId: string;
  userId: string;
  createdAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  };
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  attachments?: CommentAttachment[] | null;
}

// Shared rich text types and components moved to src/components/activity/CommentContent.tsx

function commentFilesInOrder(c: Comment): any[] {
  const out: any[] = [];
  if (c.fileUrl) {
    out.push({
      fileUrl: c.fileUrl,
      fileName: c.fileName || 'file',
      fileType: c.fileType || 'application/octet-stream',
      fileSize: typeof c.fileSize === 'number' ? c.fileSize : 0,
    });
  }
  if (Array.isArray(c.attachments)) out.push(...c.attachments);
  return out;
}

function commentSearchBlob(c: Comment): string {
  const fileNames = [c.fileName, ...(Array.isArray(c.attachments) ? c.attachments.map((a) => a.fileName) : [])]
    .filter(Boolean)
    .join(' ');
  if (isStructuredCommentText(c.text)) {
    const doc = parseCommentDoc(c.text!);
    const textParts = doc?.segments.filter((s): s is { type: 'text'; content: string } => s.type === 'text').map((s) => s.content) || [];
    return `${textParts.join('\n')} ${fileNames}`.toLowerCase();
  }
  return `${c.text || ''} ${fileNames}`.toLowerCase().trim();
}

/** Max size for files chosen via the activity sidebar comment paperclip (per file). */
const COMMENT_INPUT_MAX_FILE_BYTES = 500 * 1024 * 1024;

export function TaskDetailPage({ isModal = false, taskId: propTaskId, onClose }: { isModal?: boolean, taskId?: string, onClose?: () => void }) {
  const { id: paramsId } = useParams();
  const id = propTaskId || paramsId;
  const navigate = useNavigate();
  const { markTaskSeen } = useNotifications();
  const onlineUsers = useAppSelector(state => state.user.onlineUsers);
  const currentUser = useAppSelector(state => state.user.currentUser);
  const { isAdmin, isOwner, canUpdateTaskStatus, canUpdateTaskPriority, canAddComments, canDeleteTask, canUpdateTaskDetails, canAssignTask, isReadOnly } = useOrgRole();
  const currentOrg = useAppSelector(state => state.organization.currentOrg);
  const [task, setTask] = useState<Task | null>(null);
  const canEditDescription = isAdmin && !isReadOnly;
  const [loading, setLoading] = useState(true);
  const [commentBlocks, setCommentBlocks] = useState<CommentDraftBlock[]>(() => [{ id: generateId(), kind: 'text', text: '' }]);
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [mentionBlockId, setMentionBlockId] = useState<string | null>(null);
  const commentBlockTextareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [priorityDropdown, setPriorityDropdown] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [taskTypeKey, setTaskTypeKey] = useState<TaskTypeKey>('TASK');
  const [taskTypeOpen, setTaskTypeOpen] = useState(false);
  const taskTypeMenuRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<TaskLayout>(() => (isModal ? loadTaskLayout() : 'modal'));
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const layoutMenuRef = useRef<HTMLDivElement>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const [sidebarTab, setSidebarTab] = useState<'activity' | 'likes' | 'attachments'>('activity');
  const [mobileTab, setMobileTab] = useState<'details' | 'activity'>('details');
  const [commentSearch, setCommentSearch] = useState('');
  const [showCommentSearch, setShowCommentSearch] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const subtaskInputRef = useRef<HTMLInputElement>(null);
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<Record<string, string[]>>({});
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);

  /* ── Date editing ── */
  const [datePickerOpen, setDatePickerOpen] = useState<null | 'start' | 'due'>(null);
  const dateWrapperRef = useRef<HTMLDivElement>(null);

  /* ── Page-wide drag-and-drop for attachments ── */
  const attachmentRef = useRef<AttachmentSectionHandle>(null);
  const sidebarAttachmentRef = useRef<AttachmentSectionHandle>(null);
  // (left-panel drag-and-drop overlay removed; AttachmentSection has its own dropzone)

  /* ── Comment-area drag-and-drop ── */
  const [commentDragging, setCommentDragging] = useState(false);
  const commentDragCounter = useRef(0);

  /* ── Close logic ── */
  const handleClose = useCallback(() => {
    if (onClose) onClose();
    else if (isModal) navigate(-1);
    else navigate('/');
  }, [onClose, isModal, navigate]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Only close if no dropdowns are open
        if (!statusDropdown && !priorityDropdown && !showMore && !previewImage) {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [handleClose, statusDropdown, priorityDropdown, showMore, previewImage]);

  /* ── Time estimate ── */
  const [editingTimeEstimate, setEditingTimeEstimate] = useState(false);
  const [timeEstimate, setTimeEstimate] = useState('');

  /* ── Time tracking ── */
  const [timeRefreshKey, setTimeRefreshKey] = useState(0);
  const [showTimeTracker, setShowTimeTracker] = useState(false);

  /* ── Activity timeline ── */
  const [activities, setActivities] = useState<any[]>([]);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  /* ── Tags ── */
  const [tags, setTags] = useState<Tag[]>([]);
  const [editingTags, setEditingTags] = useState(false);
  const tagRef = useRef<HTMLDivElement>(null);

  /* ── Assignee dropdown (multi) ── */
  const [assigneeDropdown, setAssigneeDropdown] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [assignees, setAssignees] = useState<{ id: string; email: string; firstName: string; lastName: string; avatarUrl: string | null }[]>([]);
  const [teamUsers, setTeamUsers] = useState<{ id: string; email: string; firstName: string; lastName: string; avatarUrl: string | null }[]>([]);
  const assigneeRef = useRef<HTMLDivElement>(null);

  /* ── Mention State ── */
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRef = useRef<HTMLDivElement>(null);

  /* ── Display status (8-item) ── */
  const [displayStatusKey, setDisplayStatusKey] = useState<string>('OPEN');
  const [statusSearch, setStatusSearch] = useState('');

  /* ── Relationships ── */
  const [relationships, setRelationships] = useState<string[]>([]);
  const [editingRelationships, setEditingRelationships] = useState(false);
  const [newRelationship, setNewRelationship] = useState('');

  /* ── Subtasks ── */
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const socket = useSocket();

  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [addingChecklist, setAddingChecklist] = useState(false);
  const [newChecklistName, setNewChecklistName] = useState('');
  const [addingChecklistItem, setAddingChecklistItem] = useState<string | null>(null);
  const [newChecklistItemText, setNewChecklistItemText] = useState('');
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [editingChecklistId, setEditingChecklistId] = useState<string | null>(null);
  const [editingChecklistName, setEditingChecklistName] = useState('');
  const [editingChecklistItem, setEditingChecklistItem] = useState<{ checklistId: string; itemId: string } | null>(null);
  const [editingChecklistItemText, setEditingChecklistItemText] = useState('');

  /* ── Comments (from backend) ── */
  const [comments, setComments] = useState<Comment[]>([]);
  const [confirmDeleteCommentId, setConfirmDeleteCommentId] = useState<string | null>(null);
  const [isDeletingComment, setIsDeletingComment] = useState(false);
  const [confirmDeleteTaskOpen, setConfirmDeleteTaskOpen] = useState(false);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [confirmRemoveAttachment, setConfirmRemoveAttachment] = useState<{ commentId: string; fileUrl: string; fileName?: string } | null>(null);
  const [isRemovingAttachment, setIsRemovingAttachment] = useState(false);

  // Memoize the expensive feed generation (sorting, filtering, and JSON parsing for comment search)
  const feedGroups = useMemo(() => {
    const rawFeed = [
      ...comments.map(c => ({ ...c, type: 'comment' })),
      ...activities.filter(a => a.action !== 'comment.created').map(a => ({ ...a, type: 'activity' }))
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const q = commentSearch.trim().toLowerCase();
    const filteredFeed = rawFeed.filter((item: any) => {
      if (item.type !== 'comment') return true;
      if (!q) return true;
      return commentSearchBlob(item as Comment).includes(q);
    });

    const feed: any[] = [];
    filteredFeed.forEach((item: any) => {
      if (item.type === 'comment') {
        feed.push({
          type: 'commentGroup',
          userId: item.userId || item.user.id,
          user: item.user,
          createdAt: item.createdAt,
          items: [item]
        });
      } else {
        feed.push(item);
      }
    });

    return feed;
  }, [comments, activities, commentSearch]);

  const mentionNames = useMemo(() => {
    return teamUsers
      .filter((u) => u.id !== currentUser?.id)
      .map((u) => `${u.firstName}${u.lastName ? ` ${u.lastName}` : ''}`.trim());
  }, [teamUsers, currentUser?.id]);


  useEffect(() => {
    loadTask();
    loadComments();
    if (id) {
      // Viewing the task should reduce the sidebar "new/unseen" counter,
      // but should not move the inbox item to "Cleared" automatically.
      markTaskSeen(id);
      setTaskTypeKey(loadTaskType(id));
    }
  }, [id, markTaskSeen]);

  // Close the task-type menu on outside click / Escape
  useEffect(() => {
    if (!taskTypeOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (taskTypeMenuRef.current && !taskTypeMenuRef.current.contains(e.target as Node)) {
        setTaskTypeOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTaskTypeOpen(false); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [taskTypeOpen]);

  // Close the layout menu on outside click / Escape
  useEffect(() => {
    if (!layoutMenuOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (layoutMenuRef.current && !layoutMenuRef.current.contains(e.target as Node)) {
        setLayoutMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLayoutMenuOpen(false); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [layoutMenuOpen]);

  // Persist layout choice (only meaningful when opened as modal)
  useEffect(() => { if (isModal) saveTaskLayout(layout); }, [layout, isModal]);

  useEffect(() => {
    if (!socket || !id) return;

    const handleUpdate = (data?: any) => {
      if (data && data.taskId && data.taskId !== id) return;
      loadTask();
      loadComments();
    };

    socket.on('task:updated', handleUpdate);
    socket.on('task:refresh', handleUpdate);

    return () => {
      socket.off('task:updated', handleUpdate);
      socket.off('task:refresh', handleUpdate);
    };
  }, [socket, id]);

  const loadComments = async () => {
    if (!id) return;
    try {
      const [commentsRes, activitiesRes] = await batchRequests([
        () => api.get<{ success: boolean; data: Comment[] }>(`/tasks/${id}/comments`),
        () => api.get<{ success: boolean; data: any[] }>(`/tasks/${id}/activities`),
      ]);

      setComments(commentsRes.data.data);
      setActivities(activitiesRes.data.data);
    } catch {
      // ignore
    }
  };

  const deleteComment = async (commentId: string) => {
    try {
      setIsDeletingComment(true);
      await api.delete(`/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) {
      console.error('Failed to delete comment:', err);
    } finally {
      setIsDeletingComment(false);
    }
  };

  const removeCommentAttachment = async (commentId: string, fileUrl: string) => {
    try {
      setIsRemovingAttachment(true);
      const res = await api.patch<{ success: boolean; data: Comment }>(`/comments/${commentId}/attachments`, { fileUrl });
      setComments((prev) => prev.map((c) => (c.id === commentId ? res.data.data : c)));
    } catch (err) {
      console.error('Failed to remove attachment:', err);
      alert('Failed to remove attachment');
    } finally {
      setIsRemovingAttachment(false);
    }
  };

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusDropdown(false);
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityDropdown(false);
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) setAssigneeDropdown(false);
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setEditingTags(false);
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Auto-scroll to bottom of feed when new comments/activities arrive
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [comments, activities]);

  useEffect(() => {
    if (addingSubtask && subtaskInputRef.current) subtaskInputRef.current.focus();
  }, [addingSubtask]);

  /* ── Time tracking refresh handler ── */
  const handleTimeEntryChange = useCallback(() => {
    setTimeRefreshKey((k) => k + 1);
    setActivityRefreshKey((k) => k + 1);
    window.dispatchEvent(new Event('timer-update'));
  }, []);

  const loadTask = async () => {
    try {
      const res = await api.get<{ success: boolean; data: Task }>(`/tasks/${id}`);
      setTask(res.data.data);
      // Init display status from backend status
      setDisplayStatusKey(backendToDisplay(res.data.data.status));
      // Init assignees from plural assignees
      setAssignees(res.data.data.assignees || []);
      // Init tags
      setTags(res.data.data.tags || []);

      // Load team users for this task's organization
      const orgId = res.data.data.project?.organizationId || res.data.data.list?.space?.organizationId || currentOrg?.id;
      if (orgId) {
        loadTeamUsers(orgId);
      } else {
        loadTeamUsers(); // fallback
      }
    } catch (err) {
      console.error('Failed to load task:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTeamUsers = async (orgId?: string) => {
    try {
      // Only show users who are members of this organization (invited people).
      // Do NOT fall back to /users/all — that exposes every user in the system,
      // which would also leak users from previously-deleted workspaces.
      // If orgId is missing, keep current list (don't blank the dropdown).
      if (!orgId) return;

      const membersRes = await api
        .get<{ success: boolean; data: { user: any }[] }>(`/organizations/${orgId}/members`)
        .catch(() => null);

      const userMap = new Map<string, any>();
      if (membersRes && membersRes.data.success) {
        membersRes.data.data.forEach((m) => { if (m.user) userMap.set(m.user.id, m.user); });
      }

      setTeamUsers(Array.from(userMap.values()));
    } catch (err) {
      console.error('Failed to load team users:', err);
      setTeamUsers([]);
    }
  };


  const updateTask = async (updates: Record<string, unknown>) => {
    if (!task) return;
    const prevTask = { ...task };

    // OPTIMISTIC UPDATE:
    // We update the local state immediately so the UI feels fast.
    setTask({ ...task, ...updates } as Task);

    try {
      const res = await api.patch<{ success: boolean; data: Task }>(`/tasks/${id}`, updates);
      setTask(res.data.data);
      setActivityRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to update task:', err);
      // ROLLBACK on error
      setTask(prevTask);
      alert('Failed to update task. Changes rolled back.');
    }
  };

  const performDeleteTask = async () => {
    if (!id) return;
    try {
      setIsDeletingTask(true);
      await api.delete(`/tasks/${id}`);
      setConfirmDeleteTaskOpen(false);
      if (onClose) {
        onClose();
      } else if (task?.projectId) {
        navigate(`/projects/${task.projectId}`);
      } else {
        navigate('/');
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    } finally {
      setIsDeletingTask(false);
    }
  };

  const saveTitleEdit = () => {
    if (editTitle.trim() && editTitle !== task?.title) {
      updateTask({ title: editTitle.trim() });
    }
    setEditingTitle(false);
  };

  const saveDescEdit = (newHtml?: string) => {
    const valueToSave = typeof newHtml === 'string' ? newHtml : editDesc;
    if (valueToSave !== (task?.description || '')) {
      updateTask({ description: valueToSave });
    }
    setEditingDesc(false);
  };

  /* (formatTrackedTime removed — handled by TimeTracker component) */

  /* ── Subtask handlers ── */
  const handleAddSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const newSub: Subtask = {
      id: generateId(),
      title: newSubtaskTitle.trim(),
      status: 'OPEN',
    };
    setSubtasks((prev) => [...prev, newSub]);
    setNewSubtaskTitle('');
    setAddingSubtask(false);
  };

  const toggleSubtaskStatus = (subId: string) => {
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === subId ? { ...s, status: s.status === 'COMPLETED' ? 'OPEN' : 'COMPLETED' } : s
      )
    );
  };

  const deleteSubtask = (subId: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== subId));
    if (editingSubtaskId === subId) {
      setEditingSubtaskId(null);
      setEditingSubtaskTitle('');
    }
  };

  const startRenameSubtask = (sub: Subtask) => {
    setEditingSubtaskId(sub.id);
    setEditingSubtaskTitle(sub.title);
  };

  const commitRenameSubtask = () => {
    if (!editingSubtaskId) return;
    const t = editingSubtaskTitle.trim();
    if (!t) {
      setEditingSubtaskId(null);
      setEditingSubtaskTitle('');
      return;
    }
    setSubtasks((prev) => prev.map((s) => (s.id === editingSubtaskId ? { ...s, title: t } : s)));
    setEditingSubtaskId(null);
    setEditingSubtaskTitle('');
  };

  const cancelRenameSubtask = () => {
    setEditingSubtaskId(null);
    setEditingSubtaskTitle('');
  };

  /* ── Checklist handlers ── */
  const handleCreateChecklist = () => {
    if (!newChecklistName.trim()) return;
    const cl: Checklist = {
      id: generateId(),
      name: newChecklistName.trim(),
      items: [],
    };
    setChecklists((prev) => [...prev, cl]);
    setNewChecklistName('');
    setAddingChecklist(false);
  };

  const handleAddChecklistItem = (checklistId: string) => {
    if (!newChecklistItemText.trim()) return;
    const item: ChecklistItem = {
      id: generateId(),
      text: newChecklistItemText.trim(),
      checked: false,
    };
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId ? { ...cl, items: [...cl.items, item] } : cl
      )
    );
    setNewChecklistItemText('');
    setAddingChecklistItem(null);
  };

  const toggleChecklistItem = (checklistId: string, itemId: string) => {
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId
          ? {
            ...cl,
            items: cl.items.map((it) =>
              it.id === itemId ? { ...it, checked: !it.checked } : it
            ),
          }
          : cl
      )
    );
  };

  const deleteChecklistItem = (checklistId: string, itemId: string) => {
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId
          ? { ...cl, items: cl.items.filter((it) => it.id !== itemId) }
          : cl
      )
    );
    if (editingChecklistItem?.checklistId === checklistId && editingChecklistItem?.itemId === itemId) {
      setEditingChecklistItem(null);
      setEditingChecklistItemText('');
    }
  };

  const deleteChecklist = (checklistId: string) => {
    setChecklists((prev) => prev.filter((cl) => cl.id !== checklistId));
    if (editingChecklistId === checklistId) {
      setEditingChecklistId(null);
      setEditingChecklistName('');
    }
    if (editingChecklistItem?.checklistId === checklistId) {
      setEditingChecklistItem(null);
      setEditingChecklistItemText('');
    }
  };

  const startRenameChecklist = (cl: Checklist) => {
    setAddingChecklistItem(null);
    setEditingChecklistId(cl.id);
    setEditingChecklistName(cl.name);
  };

  const commitRenameChecklist = (checklistId: string) => {
    const n = editingChecklistName.trim();
    if (!n) {
      setEditingChecklistId(null);
      return;
    }
    setChecklists((prev) => prev.map((cl) => (cl.id === checklistId ? { ...cl, name: n } : cl)));
    setEditingChecklistId(null);
    setEditingChecklistName('');
  };

  const cancelRenameChecklist = () => {
    setEditingChecklistId(null);
    setEditingChecklistName('');
  };

  const startRenameChecklistItem = (checklistId: string, item: ChecklistItem) => {
    setAddingChecklistItem(null);
    setEditingChecklistItem({ checklistId, itemId: item.id });
    setEditingChecklistItemText(item.text);
  };

  const commitRenameChecklistItem = () => {
    if (!editingChecklistItem) return;
    const { checklistId, itemId } = editingChecklistItem;
    const t = editingChecklistItemText.trim();
    if (!t) {
      setEditingChecklistItem(null);
      setEditingChecklistItemText('');
      return;
    }
    setChecklists((prev) =>
      prev.map((cl) =>
        cl.id === checklistId
          ? {
            ...cl,
            items: cl.items.map((it) => (it.id === itemId ? { ...it, text: t } : it)),
          }
          : cl
      )
    );
    setEditingChecklistItem(null);
    setEditingChecklistItemText('');
  };

  const cancelRenameChecklistItem = () => {
    setEditingChecklistItem(null);
    setEditingChecklistItemText('');
  };

  /* ── Mention helpers ── */
  // Mention should only suggest people assigned to this task.
  const { filteredMentionMembers, uniqueMentionCandidates } = useMemo(() => {
    const mentionCandidates = (assignees || []).filter(Boolean);
    const unique = Array.from(
      new Map(mentionCandidates.map((m: any) => [m.id, m])).values()
    );
    const filtered = unique
      .filter(
        (m: any) =>
          m.id !== currentUser?.id &&
          `${m.firstName} ${m.lastName}`.toLowerCase().includes(mentionQuery.toLowerCase())
      )
      .slice(0, 5);
    return { filteredMentionMembers: filtered, uniqueMentionCandidates: unique };
  }, [assignees, currentUser?.id, mentionQuery]);

  const handleCommentBlockChange = (blockId: string, val: string) => {
    setCommentBlocks((prev) => prev.map((b) => (b.id === blockId && b.kind === 'text' ? { ...b, text: val } : b)));
    setMentionBlockId(blockId);
    const lastAtIdx = val.lastIndexOf('@');
    if (lastAtIdx !== -1 && (lastAtIdx === 0 || val[lastAtIdx - 1] === ' ' || val[lastAtIdx - 1] === '\n')) {
      const query = val.slice(lastAtIdx + 1);
      if (!query.includes(' ') && !query.includes('\n')) {
        setMentionQuery(query);
        setShowMentions(true);
        setMentionIndex(0);
        return;
      }
    }
    setShowMentions(false);
  };

  const insertMention = (user: { firstName: string; lastName: string }) => {
    const bid = mentionBlockId;
    if (!bid) return;
    let caretPosAfterInsert: number | null = null;
    setCommentBlocks((prev) => {
      const block = prev.find((b) => b.id === bid && b.kind === 'text');
      if (!block || block.kind !== 'text') return prev;
      const val = block.text;
      const lastAtIdx = val.lastIndexOf('@');
      if (lastAtIdx === -1) return prev;
      const fullName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const mention = fullName ? `@${fullName} ` : `@${user.firstName || ''} `;
      const afterAt = val.slice(lastAtIdx + 1);
      const nextWsRel = afterAt.search(/\s/);
      const endIdx = nextWsRel === -1 ? val.length : lastAtIdx + 1 + nextWsRel;
      const next = (val.slice(0, lastAtIdx) + mention + val.slice(endIdx)).replace(/\s@$/, '').replace(/@$/, '');
      caretPosAfterInsert = Math.min((val.slice(0, lastAtIdx) + mention).length, next.length);
      return prev.map((b) => (b.id === bid && b.kind === 'text' ? { ...b, text: next } : b));
    });
    setMentionQuery('');
    setMentionIndex(0);
    setShowMentions(false);
    window.setTimeout(() => {
      const el = commentBlockTextareaRefs.current[bid];
      if (!el) return;
      el.focus();
      const pos = caretPosAfterInsert ?? el.value.length;
      el.setSelectionRange(pos, pos);
    }, 50);
  };

  // Close mention picker on outside click
  useEffect(() => {
    if (!showMentions) return;
    const handler = (e: MouseEvent) => {
      if (mentionRef.current && !mentionRef.current.contains(e.target as Node)) {
        const mid = mentionBlockId;
        if (mid) {
          setCommentBlocks((prev) =>
            prev.map((b) =>
              b.id === mid && b.kind === 'text' ? { ...b, text: b.text.replace(/\s@$/, '').replace(/@$/, '') } : b
            )
          );
        }
        setShowMentions(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMentions, mentionBlockId]);

  /* ── Comment handler ── */
  const blocksHasContent = () => {
    const hasFile = commentBlocks.some((b) => b.kind === 'file');
    const hasText = commentBlocks.some((b) => b.kind === 'text' && b.text.trim());
    return hasFile || hasText;
  };

  const appendPendingFilesToDraft = (additions: PendingCommentFile[]) => {
    if (additions.length === 0) return;
    setCommentBlocks((prev) => {
      const out = [...prev];
      for (const item of additions) {
        out.push({ id: generateId(), kind: 'file', pending: item });
        out.push({ id: generateId(), kind: 'text', text: '' });
      }
      return out;
    });
    additions.forEach((item) => {
      if (item.file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setCommentBlocks((p) =>
            p.map((x) =>
              x.kind === 'file' && x.pending.id === item.id
                ? { ...x, pending: { ...x.pending, preview: reader.result as string } }
                : x
            )
          );
        };
        reader.readAsDataURL(item.file);
      }
    });
  };

  const removeFileDraftBlock = (blockId: string) => {
    setCommentBlocks((prev) => {
      const i = prev.findIndex((x) => x.id === blockId);
      if (i === -1) return prev;
      const cur = prev[i];
      if (cur.kind !== 'file') return prev;
      const left = prev[i - 1];
      const right = prev[i + 1];
      const without = prev.filter((_, j) => j !== i);
      if (left?.kind === 'text' && right?.kind === 'text') {
        const mergedId = left.id;
        const mergedText = `${left.text}\n${right.text}`;
        return without.filter((b) => b.id !== right.id).map((b) => (b.id === mergedId ? { ...b, text: mergedText } : b));
      }
      return without;
    });
  };

  const handlePostComment = async () => {
    if (!blocksHasContent() || !id || isPostingComment) return;
    try {
      setIsPostingComment(true);

      const fileBlocks = commentBlocks.filter((b): b is { id: string; kind: 'file'; pending: PendingCommentFile } => b.kind === 'file');
      const filesToUpload = fileBlocks.map((b) => b.pending.file);

      let primary: CommentAttachment | undefined;
      let extra: CommentAttachment[] = [];
      let textPayload = '';

      if (filesToUpload.length === 0) {
        const plain = commentBlocks
          .filter((b): b is { id: string; kind: 'text'; text: string } => b.kind === 'text')
          .map((b) => b.text)
          .join('\n')
          .replace(/\s@$/, '')
          .replace(/@$/, '')
          .trimEnd()
          .trim();
        if (!plain) {
          setIsPostingComment(false);
          return;
        }
        textPayload = plain;
      } else {
        const docSegments: CommentDocSegment[] = [];
        let fileIdx = 0;
        for (const b of commentBlocks) {
          if (b.kind === 'text') {
            docSegments.push({ type: 'text', content: b.text.replace(/\s@$/, '').replace(/@$/, '').trimEnd() });
          } else {
            docSegments.push({ type: 'file', i: fileIdx++ });
          }
        }
        while (docSegments.length > 0) {
          const last = docSegments[docSegments.length - 1];
          if (last.type === 'text' && !last.content.trim()) {
            docSegments.pop();
          } else {
            break;
          }
        }
        while (docSegments.length > 0) {
          const first = docSegments[0];
          if (first.type === 'text' && !first.content.trim()) {
            docSegments.shift();
          } else {
            break;
          }
        }
        if (docSegments.length === 0) {
          setIsPostingComment(false);
          return;
        }

        setIsUploading(true);
        const uploaded = await Promise.all(
          filesToUpload.map(async (file) => {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('path', `__COMMENT__:${file.name}`);
            const uploadRes = await api.post<{
              success: boolean;
              data: { filename: string; originalName: string; mimeType: string; size: number };
            }>(`/attachments/task/${id}`, formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            if (!uploadRes.data.success) throw new Error('Upload failed');
            const att = uploadRes.data.data;
            return {
              fileUrl: getUploadUrl(att.filename),
              fileName: file.name,
              fileType: att.mimeType,
              fileSize: att.size,
            } satisfies CommentAttachment;
          })
        );
        setIsUploading(false);
        [primary, ...extra] = uploaded;
        const doc: CommentDocV1 = { v: 1, segments: docSegments };
        textPayload = PE_COMMENT_DOC_PREFIX + JSON.stringify(doc);
      }

      const payload: {
        text: string;
        fileUrl?: string;
        fileName?: string;
        fileType?: string;
        fileSize?: number;
        attachments?: CommentAttachment[];
      } = { text: textPayload };
      if (primary) {
        payload.fileUrl = primary.fileUrl;
        payload.fileName = primary.fileName;
        payload.fileType = primary.fileType;
        payload.fileSize = primary.fileSize;
      }
      if (extra.length > 0) {
        payload.attachments = extra;
      }

      const res = await api.post<{ success: boolean; data: Comment }>(`/tasks/${id}/comments`, payload);
      setComments((prev) => [...prev, res.data.data]);
      const firstId = generateId();
      setCommentBlocks([{ id: firstId, kind: 'text', text: '' }]);
      setMentionBlockId(null);
      setSidebarTab('activity');
      setActivityRefreshKey((k) => k + 1);
      window.setTimeout(() => {
        const el = commentBlockTextareaRefs.current[firstId];
        if (el) {
          el.style.height = 'auto';
          el.focus();
        }
      }, 50);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 413) {
        alert('File is too large. Maximum upload size is 500MB.');
      } else {
        alert(err?.response?.data?.message || 'Failed to post comment');
      }
    } finally {
      setIsPostingComment(false);
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list?.length) {
      e.target.value = '';
      return;
    }
    const files = Array.from(list);
    const accepted: File[] = [];
    const rejected: File[] = [];
    for (const file of files) {
      if (file.size > COMMENT_INPUT_MAX_FILE_BYTES) rejected.push(file);
      else accepted.push(file);
    }
    if (rejected.length > 0) {
      const maxMb = (COMMENT_INPUT_MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
      if (rejected.length === 1) {
        const f = rejected[0];
        alert(
          `"${f.name}" is too large (${(f.size / (1024 * 1024)).toFixed(1)}MB). Maximum size for comment attachments is ${maxMb}MB.`
        );
      } else {
        alert(
          `${rejected.length} file(s) exceed the ${maxMb}MB limit and were not added: ${rejected.map((f) => f.name).join(', ')}`
        );
      }
    }
    if (accepted.length > 0) {
      const additions: PendingCommentFile[] = accepted.map((file) => ({
        id: generateId(),
        file,
        preview: null,
      }));
      appendPendingFilesToDraft(additions);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      const additions: PendingCommentFile[] = imageFiles.map((file) => ({
        id: generateId(),
        file,
        preview: null,
      }));
      appendPendingFilesToDraft(additions);
    }
  };

  /* ── Tag handlers ── */
  const handleToggleTag = async (tagId: string) => {
    if (!task) return;
    const isSelected = tags.some(t => t.id === tagId);
    let newTagIds: string[];

    if (isSelected) {
      newTagIds = tags.filter(t => t.id !== tagId).map(t => t.id);
    } else {
      newTagIds = [...tags.map(t => t.id), tagId];
    }

    try {
      const res = await api.patch<{ success: boolean; data: Task }>(`/tasks/${id}`, { tagIds: newTagIds });
      setTask(res.data.data);
      setTags(res.data.data.tags || []);
      setActivityRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to update tags:', err);
    }
  };

  /* ── Relationship handlers ── */
  const handleAddRelationship = () => {
    if (!newRelationship.trim()) return;
    setRelationships((prev) => [...prev, newRelationship.trim()]);
    setNewRelationship('');
    setEditingRelationships(false);
  };

  const removeRelationship = (rel: string) => {
    setRelationships((prev) => prev.filter((r) => r !== rel));
  };

  const toggleLike = (commentId: string) => {
    setLikedComments(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const addReaction = (commentId: string, emoji: string) => {
    setReactions(prev => ({
      ...prev,
      [commentId]: [...(prev[commentId] || []), emoji].slice(-5) // limit to 5
    }));
  };


  if (loading) return <Loading size="lg" />;
  if (!task) return <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">Task not found</div>;

  const priorityMeta = PRIORITY_META[task.priority];
  const dueInfo = relativeDueDate(task.dueDate);
  const createdDate = formatDate(task.createdAt);
  // In sidebar layout the inner panel is narrow — collapse the side-by-side activity
  // pane and the two-column field grid so everything stacks like the mobile layout.
  const stackVertical = isModal && layout === 'sidebar';

  const content = (
    <div
      className={
        !isModal
          ? ''
          : layout === 'sidebar'
            ? 'fixed inset-0 z-[300] flex items-stretch justify-end bg-black/40 backdrop-blur-[2px]'
            : layout === 'fullscreen'
              ? 'fixed inset-0 z-[300] bg-white dark:bg-gray-900'
              : 'fixed inset-0 z-[300] flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-black/60 backdrop-blur-[2px]'
      }
    >
      {isModal && layout !== 'fullscreen' && <div className="absolute inset-0" onClick={handleClose} />}

      <div
        className={`relative bg-white dark:bg-gray-900 flex flex-col ${stackVertical ? '' : 'lg:flex-row'} shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 ${
          !isModal
            ? 'min-h-full max-w-[1400px] w-full'
            : layout === 'sidebar'
              ? 'h-full w-full sm:w-[640px] lg:w-[820px] xl:w-[920px] max-w-full rounded-l-2xl sm:rounded-l-2xl rounded-r-none'
              : layout === 'fullscreen'
                ? 'h-screen w-screen max-w-none rounded-none'
                : 'rounded-xl sm:rounded-2xl h-[95vh] sm:h-[90vh] max-w-[1400px] w-full'
        }`}
      >
        {/* Global top-right cluster: Favorite, Layout switch, Close */}
        <div className="absolute top-1.5 right-1.5 z-[160] flex items-center gap-1">
          <button
            onClick={() => { if (!isReadOnly) updateTask({ isFavorite: !task.isFavorite }); }}
            disabled={isReadOnly}
            className={`flex items-center justify-center w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700 shadow-sm active:scale-90 ${task.isFavorite ? 'text-amber-400' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600'} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={task.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={task.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg width="16" height="16" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>

          {isModal && (
            <div className="relative" ref={layoutMenuRef}>
              <button
                onClick={() => setLayoutMenuOpen(o => !o)}
                className={`flex items-center justify-center w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-all border border-gray-100 dark:border-gray-700 shadow-sm active:scale-90 ${layoutMenuOpen ? 'text-indigo-600' : 'text-gray-500'}`}
                title="Switch layout"
                aria-label="Switch layout"
              >
                {layout === 'sidebar' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14 4v16" /></svg>
                ) : layout === 'fullscreen' ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /></svg>
                )}
              </button>

              {layoutMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-[160] bg-white dark:bg-[#0f172a] border border-gray-100 dark:border-gray-800 rounded-xl shadow-2xl p-2 flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
                  {([
                    { key: 'modal' as const, label: 'Modal' },
                    { key: 'fullscreen' as const, label: 'Full screen' },
                    { key: 'sidebar' as const, label: 'Sidebar' },
                  ]).map(opt => {
                    const active = layout === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => { setLayout(opt.key); setLayoutMenuOpen(false); }}
                        className={`w-[88px] flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all ${active ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300 hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
                        title={opt.label}
                      >
                        <div className={`w-12 h-8 rounded-md border ${active ? 'border-indigo-400' : 'border-gray-300 dark:border-gray-600'} bg-white dark:bg-gray-900 relative overflow-hidden`}>
                          {opt.key === 'modal' && (
                            <div className="absolute inset-1 rounded-sm bg-gray-200 dark:bg-gray-700" />
                          )}
                          {opt.key === 'fullscreen' && (
                            <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700" />
                          )}
                          {opt.key === 'sidebar' && (
                            <>
                              <div className="absolute inset-y-0 left-0 w-1/2 bg-gray-100 dark:bg-gray-800" />
                              <div className="absolute inset-y-0 right-0 w-1/2 bg-gray-300 dark:bg-gray-600" />
                            </>
                          )}
                        </div>
                        <span className={`text-[11px] font-medium ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-300'}`}>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-md hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-all border border-gray-100 dark:border-gray-700 shadow-sm active:scale-90"
            title="Close (Esc)"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* ══════════ Mobile Tab Bar ══════════ */}
        <div className={`flex ${stackVertical ? '' : 'lg:hidden'} border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0`}>
          <button
            onClick={() => setMobileTab('details')}
            className={`flex-1 py-2.5 text-xs font-bold text-center transition-colors relative ${mobileTab === 'details' ? 'text-indigo-600' : 'text-gray-400'}`}
          >
            Details
            {mobileTab === 'details' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
          </button>
          <button
            onClick={() => setMobileTab('activity')}
            className={`flex-1 py-2.5 text-xs font-bold text-center transition-colors relative ${mobileTab === 'activity' ? 'text-indigo-600' : 'text-gray-400'}`}
          >
            Activity
            {mobileTab === 'activity' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />}
          </button>
        </div>

        {/* ══════════ Main Content ══════════ */}
        <div
          className={`relative flex-1 min-w-0 min-h-0 flex flex-col ${stackVertical ? '' : 'lg:border-r'} border-gray-200 dark:border-gray-700 ${mobileTab === 'activity' ? (stackVertical ? 'hidden' : 'hidden lg:flex') : 'flex'}`}
        >
          {/* ── Top bar ── */}
          <div className="flex items-center justify-between px-3 sm:px-5 py-2 sm:py-2.5 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shrink-0">
            <div className="flex items-center gap-1.5 sm:gap-2 text-[12px] sm:text-[13px] min-w-0">
              <div className="w-5 h-5 rounded bg-indigo-500 flex items-center justify-center shrink-0">
                <span className="text-white text-[10px] font-bold">T</span>
              </div>
              <Link to={`/projects/${task.projectId}`} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 truncate hidden sm:inline">
                {task.project?.name || 'Project'}
              </Link>
              <span className="text-gray-300 dark:text-gray-600 hidden sm:inline">/</span>
              <span className="flex items-center gap-1 text-gray-800 dark:text-gray-200 font-medium truncate">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="hidden sm:block shrink-0">
                  <path d="M4 6h16M4 12h16M4 18h10" />
                </svg>
                {task.title}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 text-xs text-gray-400 dark:text-gray-500 shrink-0">
              <span className="hidden sm:inline">Created {createdDate}</span>
              <button
                onClick={async () => {
                  const url = `${window.location.origin}/tasks/${task.id}`;
                  try {
                    if (navigator.share) {
                      await navigator.share({ title: task.title, url });
                      return;
                    }
                  } catch { /* user cancelled */ }
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(url);
                    } else {
                      const ta = document.createElement('textarea');
                      ta.value = url;
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.select();
                      document.execCommand('copy');
                      document.body.removeChild(ta);
                    }
                    setShareCopied(true);
                    setTimeout(() => setShareCopied(false), 1800);
                  } catch { /* noop */ }
                }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs font-medium hidden sm:block"
                title="Copy task link"
              >
                {shareCopied ? '✓ Copied' : 'Share'}
              </button>
              <div className="relative" ref={moreRef}>
                <button
                  onClick={() => setShowMore(!showMore)}
                  className={`flex items-center justify-center p-1.5 rounded-lg transition-colors ${showMore ? 'bg-gray-100 dark:bg-gray-800 text-indigo-600' : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'}`}
                  title="More options"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                </button>

                {showMore && (
                  <div className="absolute right-0 top-full mt-1.5 w-48 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-xl z-[100] overflow-hidden py-1">
                    <button
                      onClick={() => {
                        const url = window.location.href;


                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(url);
                        } else {
                          const ta = document.createElement('textarea');
                          ta.value = url;
                          ta.style.position = 'fixed';
                          ta.style.opacity = '0';
                          document.body.appendChild(ta);
                          ta.select();
                          document.execCommand('copy');
                          document.body.removeChild(ta);
                        }
                        setShowMore(false);
                        alert('Task link copied to clipboard!');
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>
                      Copy Link
                    </button>

                    {canDeleteTask && (
                      <>
                        <div className="h-px bg-gray-50 dark:bg-gray-700/50 my-1 mx-2" />
                        <button
                          onClick={() => { setShowMore(false); setConfirmDeleteTaskOpen(true); }}
                          className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6" /></svg>
                          Delete Task
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>



          {/* ── Scrollable content ── */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-4 py-4 sm:px-8 sm:py-6">
              {/* Task type & ID row */}
              <div className="flex items-center gap-3 mb-4">
                <div className="relative" ref={taskTypeMenuRef}>
                  {(() => {
                    const current = TASK_TYPES.find(t => t.key === taskTypeKey) || TASK_TYPES[0];
                    return (
                      <button
                        onClick={() => setTaskTypeOpen(o => !o)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-gray-200 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        title="Change task type"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full ${current.colorClass}`} />
                        <span className="font-medium">{current.label}</span>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
                      </button>
                    );
                  })()}

                  {taskTypeOpen && (
                    <div className="absolute z-50 mt-1 left-0 w-[260px] bg-white dark:bg-[#0f172a] rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.18)] border border-gray-100 dark:border-gray-800 py-2 animate-in zoom-in-95">
                      <div className="flex items-center justify-between px-3 pb-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1">
                          Task Types
                          <span className="text-gray-300 dark:text-gray-600" title="Choose how this task should appear">ⓘ</span>
                        </span>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto">
                        {TASK_TYPES.map((t) => {
                          const isActive = t.key === taskTypeKey;
                          const isDefault = t.key === 'TASK';
                          return (
                            <button
                              key={t.key}
                              onClick={() => {
                                setTaskTypeKey(t.key);
                                if (id) saveTaskType(id, t.key);
                                setTaskTypeOpen(false);
                              }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${isActive ? 'bg-gray-50 dark:bg-gray-800/60' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}
                            >
                              <span className={`w-3.5 h-3.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold text-white ${t.colorClass}`}>{t.icon}</span>
                              <span className="flex-1 text-gray-800 dark:text-gray-200">{t.label}</span>
                              {isDefault && (
                                <span className="text-[10px] text-gray-400 dark:text-gray-500">(default)</span>
                              )}
                              {isActive && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-gray-700 dark:text-gray-300"><path d="M5 12l5 5L20 7" /></svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{task.id.slice(0, 8)}</span>
              </div>

              {/* ── Title ── */}
              {editingTitle ? (
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={saveTitleEdit}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveTitleEdit(); if (e.key === 'Escape') setEditingTitle(false); }}
                  autoFocus
                  className="text-2xl font-bold text-gray-900 dark:text-white w-full border-b-2 border-indigo-500 outline-none pb-1 mb-2 bg-transparent"
                  title="Task title"
                  placeholder="Enter task title..."
                />
              ) : (
                <div className="flex items-center gap-2 sm:gap-3">
                  <h1
                    className={`text-xl sm:text-2xl font-bold mb-2 rounded px-1 -mx-1 py-0.5 ${canUpdateTaskDetails ? 'text-gray-900 dark:text-white cursor-text hover:bg-gray-50 dark:hover:bg-gray-700' : 'text-gray-700 dark:text-gray-300'}`}
                    onClick={() => { if (canUpdateTaskDetails) { setEditTitle(task.title); setEditingTitle(true); } }}
                  >
                    {task.title}
                  </h1>
                </div>
              )}

              {/* ── Properties grid ── */}
              <div className={`grid ${stackVertical ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-x-4 sm:gap-x-8 gap-y-2 sm:gap-y-3 mb-6 text-sm`}>
                {/* Status */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconStatus />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</span>
                  </div>
                  <div className="relative" ref={statusRef}>
                    {(() => {
                      const ds = DISPLAY_STATUSES.find(s => s.key === displayStatusKey) || DISPLAY_STATUSES[0];
                      const handleMarkDone = () => {
                        const closedStatus = DISPLAY_STATUSES.find(s => s.backendStatus === 'CLOSED');
                        if (closedStatus) {
                          setDisplayStatusKey(closedStatus.key);
                          updateTask({ status: 'CLOSED' });
                        }
                      };

                      const handleNextStatus = () => {
                        const sequence: TaskStatus[] = ['OPEN', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED', 'CLOSED'];
                        const currentIdx = sequence.indexOf(task.status);

                        if (currentIdx !== -1 && currentIdx < sequence.length - 1) {
                          const nextStatus = sequence[currentIdx + 1];
                          const dsNext = DISPLAY_STATUSES.find(s => s.backendStatus === nextStatus);
                          if (dsNext) {
                            setDisplayStatusKey(dsNext.key);
                            updateTask({ status: nextStatus });
                          }
                        }
                      };

                      return (
                        <StatusBadge
                          ds={ds}
                          canUpdate={canUpdateTaskStatus}
                          onClick={() => { if (canUpdateTaskStatus) { setStatusDropdown(!statusDropdown); setStatusSearch(''); } }}
                          onMarkDone={handleMarkDone}
                          onNextStatus={handleNextStatus}
                        />
                      );
                    })()}

                    {/* Status Dropdown */}
                    {statusDropdown && (
                      <div className="absolute left-0 top-full mt-1.5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl shadow-2xl dark:shadow-black/20 z-50 w-[240px] overflow-hidden p-1.5 animate-in fade-in zoom-in-95 duration-150">
                        {/* Search */}
                        <div className="px-2 pb-2">
                          <div className="relative">
                            <input
                              value={statusSearch}
                              onChange={e => setStatusSearch(e.target.value)}
                              autoFocus
                              className="w-full text-sm bg-gray-50/50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-gray-700 dark:text-gray-200"
                              title="Search statuses"
                              placeholder="Search..."
                            />
                            {!statusSearch && (
                              <svg className="absolute right-3 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            )}
                          </div>
                        </div>

                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                          {/* Open statuses */}
                          <div className="mb-2">
                            <div className="px-3 py-1.5 text-sm font-semibold text-gray-400 dark:text-gray-500">Statuses</div>
                            {DISPLAY_STATUSES.filter(s => s.section === 'statuses' && s.label.toLowerCase().includes(statusSearch.toLowerCase())).map(s => (
                              <button
                                key={s.key}
                                onClick={() => {
                                  setDisplayStatusKey(s.key);
                                  updateTask({ status: s.backendStatus });
                                  setStatusDropdown(false);
                                  setStatusSearch('');
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all mb-0.5",
                                  displayStatusKey === s.key ? "bg-gray-100/80 dark:bg-gray-700/50" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                                )}
                              >
                                <StatusOption s={s} isSelected={displayStatusKey === s.key} />
                                {displayStatusKey === s.key && (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-800 dark:text-gray-200">
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>

                          {/* Closed section */}
                          <div className="border-t border-gray-50 dark:border-gray-700 pt-2 mb-1">
                            <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 dark:text-gray-500">Closed</div>
                            {DISPLAY_STATUSES.filter(s => s.section === 'closed' && s.label.toLowerCase().includes(statusSearch.toLowerCase())).map(s => (
                              <button
                                key={s.key}
                                onClick={() => {
                                  setDisplayStatusKey(s.key);
                                  updateTask({ status: s.backendStatus });
                                  setStatusDropdown(false);
                                  setStatusSearch('');
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-2 rounded-xl transition-all",
                                  displayStatusKey === s.key ? "bg-gray-100/80 dark:bg-gray-700/50" : "hover:bg-gray-50 dark:hover:bg-gray-700/30"
                                )}
                              >
                                <StatusOption s={s} isSelected={displayStatusKey === s.key} />
                                {displayStatusKey === s.key && (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="text-gray-800 dark:text-gray-200">
                                    <path d="M20 6L9 17l-5-5" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Assignees */}
                <div className="flex items-start gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white pt-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Assignee</span>
                  </div>
                  <div className="relative" ref={assigneeRef}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <AvatarStack
                        users={assignees}
                        size="md"
                        showPlaceholder
                        max={5}
                        onRemove={canAssignTask ? (userId) => {
                          const next = assignees.filter(a => a.id !== userId);
                          setAssignees(next);
                          updateTask({ assigneeIds: next.map(a => a.id) });
                        } : undefined}
                      />

                      {/* Add assignee trigger */}
                      {canAssignTask && (
                        <button
                          onClick={() => { setAssigneeDropdown(!assigneeDropdown); setAssigneeSearch(''); }}
                          className="w-6 h-6 rounded-md border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
                          title="Add assignee"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 4v16m8-8H4" /></svg>
                        </button>
                      )}
                    </div>

                    {/* Assignee Dropdown */}
                    {assigneeDropdown && (
                      <div className="absolute left-0 top-full mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl dark:shadow-gray-900 z-[100] w-[280px] overflow-hidden animate-scale-in origin-top-left">
                        {/* Header with selected and close */}
                        <div className="flex items-center justify-between p-2.5 pb-1">
                          <div className="flex items-center gap-1 flex-wrap">
                            {assignees.map(u => (
                              <div key={u.id} className="relative">
                                <UserAvatar
                                  user={u}
                                  className="w-7 h-7 rounded-lg border border-white dark:border-gray-800 object-cover shadow-sm"
                                  fallbackClassName="w-7 h-7 rounded-lg bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center border border-white dark:border-gray-800 shadow-sm"
                                />
                              </div>
                            ))}
                          </div>
                          <button onClick={() => setAssigneeDropdown(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" title="Close dropdown">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        </div>

                        {/* Search */}
                        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                          <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/20">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                            <input
                              type="text"
                              value={assigneeSearch}
                              onChange={e => setAssigneeSearch(e.target.value)}
                              placeholder="Search or enter email..."
                              autoFocus
                              className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 font-medium"
                              title="Search members"
                            />
                          </div>
                        </div>

                        <div className="max-h-64 overflow-y-auto p-1 custom-scrollbar">
                          {teamUsers.filter(u => `${u.firstName} ${u.lastName}`.toLowerCase().includes(assigneeSearch.toLowerCase())).map(u => {
                            const isAssigned = assignees.some(a => a.id === u.id);
                            const isOnline = onlineUsers.includes(u.id);
                            const isMe = u.id === currentUser?.id;

                            return (
                              <button
                                key={u.id}
                                onClick={() => {
                                  const next = isAssigned ? assignees.filter(a => a.id !== u.id) : [...assignees, u];
                                  setAssignees(next);
                                  updateTask({ assigneeIds: next.map(a => a.id) });
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors group mb-0.5",
                                  isAssigned ? "bg-indigo-50 dark:bg-indigo-900/20" : "hover:bg-gray-50 dark:hover:bg-gray-800/30"
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div className="relative shrink-0">
                                    <div className={cn(
                                      "p-0.5 rounded-lg transition-all",
                                      isAssigned ? "ring-2 ring-indigo-500" : "ring-0"
                                    )}>
                                      <UserAvatar
                                        user={u}
                                        className="w-8 h-8 rounded-lg object-cover border border-gray-100 dark:border-gray-800"
                                        fallbackClassName={cn(
                                          "w-8 h-8 rounded-lg text-white text-[10px] font-bold flex items-center justify-center border border-gray-100 dark:border-gray-800",
                                          isMe ? "bg-indigo-600" : "bg-gray-400"
                                        )}
                                      />
                                    </div>
                                    {isOnline && (
                                      <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-gray-800 rounded-full" />
                                    )}
                                  </div>
                                  <span className={cn(
                                    "text-[13px] font-medium transition-colors",
                                    isAssigned ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-gray-600 dark:text-gray-300"
                                  )}>
                                    {isMe ? "Me" : `${u.firstName} ${u.lastName}`}
                                  </span>
                                </div>
                                {(!isMe && !isAssigned) && (
                                  <div className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-400 shadow-sm">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Footer */}
                        <div className="border-t border-gray-100 dark:border-gray-700 p-2 space-y-1.5 bg-gray-50/30 dark:bg-gray-800/30">
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => {
                                setAssignees([]);
                                updateTask({ assigneeIds: [] });
                              }}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-black text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all border border-transparent hover:border-red-100"
                              title="Remove all assignees"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                              REMOVE ALL
                            </button>
                            <button
              onClick={() => loadTeamUsers(task?.project?.organizationId || task?.list?.space?.organizationId || currentOrg?.id)}
                              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-black text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-all border border-transparent hover:border-emerald-100"
                              title="Refresh team members"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                              REFRESH
                            </button>
                          </div>
                          <button className="w-full flex items-center justify-center gap-2 py-1.5 text-[11px] text-indigo-500 hover:text-indigo-700 font-medium" title="Fill with AI">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
                            Set up fill with AI
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dates */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconCalendar />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Due Date</span>
                  </div>
                  <div ref={dateWrapperRef} className="relative flex items-center gap-1.5 text-xs">
                    <button
                      onClick={() => { if (canUpdateTaskDetails) setDatePickerOpen(datePickerOpen === 'start' ? null : 'start'); }}
                      className={`flex items-center gap-1 ${canUpdateTaskDetails ? 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300' : 'text-gray-300 dark:text-gray-600 cursor-default'}`}
                      title="Edit start date"
                    >
                      <IconCalendar />
                      <span>{task.startDate ? formatDate(task.startDate) : 'Start'}</span>
                    </button>
                    <span className="text-gray-400 dark:text-gray-500 mx-0.5">→</span>
                    <div className="group/duedate flex items-center gap-1">
                      <button
                        onClick={() => { if (canUpdateTaskDetails) setDatePickerOpen(datePickerOpen === 'due' ? null : 'due'); }}
                        className={`flex items-center gap-1 font-medium ${dueInfo.overdue ? 'text-red-500' : task.dueDate ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}
                        title="Edit due date"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={dueInfo.overdue ? '#ef4444' : 'currentColor'} strokeWidth="2">
                          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
                        </svg>
                        {dueInfo.text}
                      </button>
                      {task.dueDate && canUpdateTaskDetails && (
                        <button
                          onClick={(e) => { e.stopPropagation(); updateTask({ dueDate: null }); }}
                          className="opacity-0 group-hover/duedate:opacity-100 p-0.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                          title="Remove due date"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      )}
                    </div>

                    {datePickerOpen === 'start' && (
                      <DatePickerPopup
                        selectedDate={task.startDate}
                        onChange={(iso) => updateTask({ startDate: iso })}
                        onClear={() => updateTask({ startDate: null })}
                        onClose={() => setDatePickerOpen(null)}
                      />
                    )}
                    {datePickerOpen === 'due' && (
                      <DatePickerPopup
                        selectedDate={task.dueDate}
                        onChange={(iso) => updateTask({ dueDate: iso })}
                        onClear={() => updateTask({ dueDate: null })}
                        onClose={() => setDatePickerOpen(null)}
                      />
                    )}
                  </div>
                </div>

                {/* Priority */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconFlag color="currentColor" />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Priority</span>
                  </div>
                  <div className="relative" ref={priorityRef}>
                    <button
                      onClick={() => { if (canUpdateTaskPriority) setPriorityDropdown(!priorityDropdown); }}
                      className="flex items-center gap-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md px-1.5 py-0.5"
                      title="Change priority"
                    >
                      <IconFlag color={priorityMeta.color} />
                      <span className="font-medium text-gray-700 dark:text-gray-300">{priorityMeta.label}</span>
                    </button>
                    {priorityDropdown && (
                      <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg dark:shadow-gray-900 py-1 z-50 min-w-[140px]">
                        {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as TaskPriority[]).map((p) => (
                          <button
                            key={p}
                            onClick={() => { updateTask({ priority: p }); setPriorityDropdown(false); }}
                            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-gray-700 ${task.priority === p ? 'font-bold' : ''}`}
                            title={`Set priority to ${PRIORITY_META[p].label}`}
                          >
                            <IconFlag color={PRIORITY_META[p].color} />
                            {PRIORITY_META[p].label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Time Estimate */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconHourglass />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Time estimate</span>
                  </div>
                  {editingTimeEstimate ? (
                    <input
                      type="text"
                      value={timeEstimate}
                      onChange={(e) => setTimeEstimate(e.target.value)}
                      onBlur={() => setEditingTimeEstimate(false)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setEditingTimeEstimate(false); if (e.key === 'Escape') setEditingTimeEstimate(false); }}
                      placeholder="e.g. 2h 30m"
                      autoFocus
                      className="text-xs border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 outline-none w-24 bg-transparent dark:text-gray-300"
                      title="Time estimate"
                    />
                  ) : (
                    <button
                      onClick={() => { if (canUpdateTaskDetails) setEditingTimeEstimate(true); }}
                      className={`text-xs ${canUpdateTaskDetails ? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300' : 'text-gray-300 dark:text-gray-600 cursor-default'}`}
                      title="Edit time estimate"
                    >
                      {timeEstimate || 'Empty'}
                    </button>
                  )}
                </div>

                {/* Track Time */}
                <div className="flex items-start gap-2 sm:gap-3 col-span-1 sm:col-span-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white pt-1.5">
                    <IconTrackTime />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Track time</span>
                  </div>
                  <div className="flex-1 space-y-3">
                    {task.status !== 'COMPLETED' && !isReadOnly && (
                      <button
                        onClick={() => setShowTimeTracker(!showTimeTracker)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full text-sm font-medium text-gray-600 dark:text-gray-300 transition-all shadow-sm"
                        title={showTimeTracker ? "Hide time tracker" : "Open time tracker"}
                      >
                        <div className="w-5 h-5 bg-gray-400 dark:bg-gray-500 rounded-full flex items-center justify-center text-white">
                          {showTimeTracker ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6 11h12v2H6z" /></svg>
                          ) : (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                          )}
                        </div>
                        {showTimeTracker ? 'Hide' : 'Start'}
                      </button>
                    )}

                    {showTimeTracker && (
                      <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                        <TimeTracker taskId={id!} onEntryChange={handleTimeEntryChange} />
                      </div>
                    )}
                    <TimeEntryList taskId={id!} refreshKey={timeRefreshKey} />
                  </div>
                </div>

                {/* Tags */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconTag />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Tags</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap relative" ref={tagRef}>
                    {tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold border transition-all"
                        {...{
                          style: {
                            backgroundColor: `${tag.color}15`,
                            color: tag.color,
                            borderColor: `${tag.color}30`
                          }
                        }}
                      >
                        <div className="w-1.5 h-1.5 rounded-md" {...{ style: { backgroundColor: tag.color } }} />
                        {tag.name}
                        {isAdmin && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleTag(tag.id); }}
                            className="hover:opacity-70 ml-0.5"
                            title="Remove tag"
                          >
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                          </button>
                        )}
                      </span>
                    ))}

                    {isAdmin && (
                      <div className="relative">
                        <button
                          onClick={() => { if (canUpdateTaskDetails) setEditingTags(!editingTags); }}
                          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
                          title="Edit tags"
                        >
                          {tags.length === 0 ? 'Empty' : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 5v14M5 12h14" /></svg>
                          )}
                        </button>

                        {editingTags && task && (
                          <div className="absolute left-0 top-full mt-2 z-50">
                            <TagPicker
                              organizationId={task.project?.organizationId || task.list?.space?.organizationId || ''}
                              selectedTagIds={tags.map(t => t.id)}
                              onToggleTag={handleToggleTag}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Relationships */}
                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2 w-[100px] sm:w-[130px] shrink-0 text-gray-500 dark:text-white">
                    <IconLink />
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Relationships</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {relationships.map((rel) => (
                      <span key={rel} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-[11px] font-medium">
                        {rel}
                        <button onClick={() => { if (canUpdateTaskDetails) removeRelationship(rel); }} className={`${canUpdateTaskDetails ? 'hover:text-gray-800 dark:hover:text-white transition-colors' : 'hidden'}`} title="Remove relationship">
                          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ))}
                    {editingRelationships ? (
                      <input
                        type="text"
                        value={newRelationship}
                        onChange={(e) => setNewRelationship(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddRelationship(); if (e.key === 'Escape') setEditingRelationships(false); }}
                        onBlur={() => { if (newRelationship.trim()) handleAddRelationship(); else setEditingRelationships(false); }}
                        placeholder="Link name"
                        autoFocus
                        className="text-xs border border-gray-200 dark:border-gray-700 rounded px-2 py-0.5 outline-none w-24 bg-transparent dark:text-gray-300"
                        title="Relationship name"
                      />
                    ) : (
                      <button
                        onClick={() => { if (canUpdateTaskDetails) setEditingRelationships(true); }}
                        className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        title="Add relationship"
                      >
                        {relationships.length === 0 ? 'Empty' : '+'}
                      </button>
                    )}
                  </div>
                </div>

              </div>

              <div className="mb-8 border-t border-gray-100 dark:border-gray-700 pt-5">
                {editingDesc ? (
                  <TaskDescriptionEditor
                    initialValue={editDesc}
                    taskId={id!}
                    workspaceName={task?.list?.space?.name || task?.project?.name || currentOrg?.name}
                    onSave={saveDescEdit} // This now correctly takes the newHtml argument
                    onCancel={() => setEditingDesc(false)}
                  />
                ) : (
                  <div
                    className={`prose prose-sm max-w-none text-gray-700 dark:text-gray-300 min-h-[40px] flex items-center gap-3 ${canEditDescription ? 'cursor-text hover:bg-gray-50/50 dark:hover:bg-gray-800/50' : ''}`}
                    onClick={() => { if (canEditDescription) { setEditDesc(task.description || ''); setEditingDesc(true); } }}
                  >
                    {task.description ? (
                      <div
                        className={`space-y-1 editor-content flex-1 py-1 ${!showFullDesc ? 'line-clamp-4' : ''}`}
                        dangerouslySetInnerHTML={{ __html: linkifyHtmlText(task.description) }}
                      />
                    ) : (
                      <div className="flex items-center gap-2.5 text-gray-400 dark:text-gray-500 flex-1 py-1 group">
                        <span className="w-5 h-5 flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 font-bold text-xs text-gray-300 group-hover:text-indigo-500 group-hover:border-indigo-200 transition-colors">+</span>
                        <span className="text-sm italic">Write here description…</span>
                      </div>
                    )}
                  </div>
                )}
                {task.description && task.description.length > 150 && !editingDesc && (
                  <div className="flex justify-center w-full mt-3 mb-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowFullDesc(!showFullDesc); }}
                      className="flex items-center gap-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-2.5 py-1 rounded shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-all active:scale-95"
                    >
                      {showFullDesc ? (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Collapse
                        </>
                      ) : (
                        <>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          Expand
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              <div className="h-px w-full bg-gray-100 dark:bg-gray-800 my-6" />

              {/* ── Subtasks ── */}
              <div className="mb-8 overflow-visible">
                <div className="flex items-center justify-between mb-3 border-b border-gray-50 dark:border-gray-800 pb-1">
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Subtasks</h3>
                  {canUpdateTaskDetails && (
                    <button
                      onClick={() => setAddingSubtask(true)}
                      className="flex items-center gap-1 text-sm text-indigo-500 hover:text-indigo-700 font-bold"
                      title="Add subtask"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                      Add
                    </button>
                  )}
                </div>

                {/* Subtask list */}
                {subtasks.length > 0 && (
                  <div className="mb-3 border border-gray-100 dark:border-gray-700 rounded-lg overflow-hidden">
                    {subtasks.map((sub) => (
                      <div key={sub.id} className="flex items-center gap-2.5 px-3 py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-b-0 group hover:bg-gray-50 dark:hover:bg-gray-700">
                        <button
                          type="button"
                          onClick={() => { if (canUpdateTaskDetails && editingSubtaskId !== sub.id) toggleSubtaskStatus(sub.id); }}
                          className={`w-4 h-4 rounded-md border-2 flex items-center justify-center shrink-0 ${sub.status === 'COMPLETED' ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'
                            }`}
                          title={sub.status === 'COMPLETED' ? "Mark as incomplete" : "Mark as complete"}
                        >
                          {sub.status === 'COMPLETED' && (
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                          )}
                        </button>
                        {canUpdateTaskDetails && editingSubtaskId === sub.id ? (
                          <div className="flex flex-1 items-center gap-1.5 min-w-0">
                            <input
                              type="text"
                              value={editingSubtaskTitle}
                              onChange={(e) => setEditingSubtaskTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRenameSubtask(); }
                                if (e.key === 'Escape') { e.preventDefault(); cancelRenameSubtask(); }
                              }}
                              autoFocus
                              className="flex-1 text-sm border border-indigo-200 dark:border-indigo-800 rounded-md px-2 py-1 outline-none focus:border-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-200 min-w-0"
                              title="Rename subtask"
                            />
                            <button
                              type="button"
                              onClick={commitRenameSubtask}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 shrink-0 px-1"
                              title="Save name"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelRenameSubtask}
                              className="text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0 px-1"
                              title="Cancel"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span className={`text-sm flex-1 ${sub.status === 'COMPLETED' ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                            {sub.title}
                          </span>
                        )}
                        {canUpdateTaskDetails && editingSubtaskId !== sub.id && (
                          <>
                            <button
                              type="button"
                              onClick={() => startRenameSubtask(sub)}
                              className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors shrink-0"
                              title="Rename subtask"
                            >
                              <IconPencilSmall />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSubtask(sub.id)}
                              className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors shrink-0"
                              title="Delete subtask"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Add subtask input */}
                {canUpdateTaskDetails && (addingSubtask ? (
                  <div className="flex items-center gap-2">
                    <input
                      ref={subtaskInputRef}
                      type="text"
                      value={newSubtaskTitle}
                      onChange={(e) => setNewSubtaskTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddSubtask(); if (e.key === 'Escape') setAddingSubtask(false); }}
                      placeholder="Subtask name"
                      className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 outline-none focus:border-indigo-400 bg-transparent dark:text-gray-300"
                      title="Subtask name"
                    />
                    <button
                      onClick={handleAddSubtask}
                      disabled={!newSubtaskTitle.trim()}
                      className="px-3 py-1.5 bg-indigo-500 text-white text-xs rounded-md hover:bg-indigo-600 disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setAddingSubtask(false)}
                      className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null)}
              </div>

              {/* ── Status Change Log at Bottom ── */}
              <div className="mt-auto py-4" />


              {/* ── Checklists ── */}
              <div className="mb-8">
                <div className="flex items-center justify-between mb-3 border-b border-gray-50 dark:border-gray-800 pb-1">
                  <h3 className="text-sm font-bold text-gray-800 dark:text-gray-200">Checklists</h3>
                  {canUpdateTaskDetails && (
                    <button
                      type="button"
                      onClick={() => setAddingChecklist(true)}
                      className="flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-bold"
                      title="Add checklist"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14" /></svg>
                      Add
                    </button>
                  )}
                </div>

                {/* Existing checklists */}
                {checklists.map((cl) => {
                  const doneCount = cl.items.filter((it) => it.checked).length;
                  const totalCount = cl.items.length;
                  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

                  return (
                    <div key={cl.id} className="mb-4 border border-gray-100 dark:border-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        {canUpdateTaskDetails && editingChecklistId === cl.id ? (
                          <div className="flex flex-1 items-center gap-2 min-w-0">
                            <input
                              type="text"
                              value={editingChecklistName}
                              onChange={(e) => setEditingChecklistName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRenameChecklist(cl.id); }
                                if (e.key === 'Escape') { e.preventDefault(); cancelRenameChecklist(); }
                              }}
                              autoFocus
                              className="flex-1 text-sm font-semibold border border-indigo-200 dark:border-indigo-800 rounded-md px-2 py-1 outline-none focus:border-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-200 min-w-0"
                              title="Rename checklist"
                            />
                            <button
                              type="button"
                              onClick={() => commitRenameChecklist(cl.id)}
                              className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 shrink-0"
                              title="Save"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={cancelRenameChecklist}
                              className="text-[11px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0"
                              title="Cancel"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 truncate min-w-0 flex-1">{cl.name}</h4>
                        )}
                        <div className="flex items-center gap-2 shrink-0">
                          {totalCount > 0 && (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">{doneCount}/{totalCount} ({pct}%)</span>
                          )}
                          {canUpdateTaskDetails && editingChecklistId !== cl.id && (
                            <button
                              type="button"
                              onClick={() => startRenameChecklist(cl)}
                              className="text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors"
                              title="Rename checklist"
                            >
                              <IconPencilSmall />
                            </button>
                          )}
                          {canUpdateTaskDetails && (
                            <button
                              type="button"
                              onClick={() => deleteChecklist(cl.id)}
                              className="text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors"
                              title="Delete checklist"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      {totalCount > 0 && (
                        <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-700 rounded-md mb-2 overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-md transition-all"
                            {...{ style: pct ? { width: `${pct}%` } : {} }}
                          />
                        </div>
                      )}

                      {/* Checklist items */}
                      {cl.items.map((item) => (
                        <div key={item.id} className="flex items-center gap-2.5 py-1.5 group">
                          <button
                            type="button"
                            onClick={() => { if (canUpdateTaskDetails && !(editingChecklistItem?.checklistId === cl.id && editingChecklistItem?.itemId === item.id)) toggleChecklistItem(cl.id, item.id); }}
                            className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 ${item.checked ? 'bg-green-500 border-green-500' : 'border-gray-300 dark:border-gray-600'
                              }`}
                            title={item.checked ? "Uncheck" : "Check"}
                          >
                            {item.checked && (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M5 13l4 4L19 7" /></svg>
                            )}
                          </button>
                          {canUpdateTaskDetails && editingChecklistItem?.checklistId === cl.id && editingChecklistItem?.itemId === item.id ? (
                            <div className="flex flex-1 items-center gap-1.5 min-w-0">
                              <input
                                type="text"
                                value={editingChecklistItemText}
                                onChange={(e) => setEditingChecklistItemText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); commitRenameChecklistItem(); }
                                  if (e.key === 'Escape') { e.preventDefault(); cancelRenameChecklistItem(); }
                                }}
                                autoFocus
                                className="flex-1 text-sm border border-indigo-200 dark:border-indigo-800 rounded-md px-2 py-0.5 outline-none focus:border-indigo-400 bg-white dark:bg-gray-800 dark:text-gray-200 min-w-0"
                                title="Rename item"
                              />
                              <button
                                type="button"
                                onClick={commitRenameChecklistItem}
                                className="text-[10px] font-bold text-indigo-600 shrink-0"
                                title="Save"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelRenameChecklistItem}
                                className="text-[10px] text-gray-500 shrink-0"
                                title="Cancel"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <span className={`text-sm flex-1 ${item.checked ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                              {item.text}
                            </span>
                          )}
                          {canUpdateTaskDetails && !(editingChecklistItem?.checklistId === cl.id && editingChecklistItem?.itemId === item.id) && (
                            <>
                              <button
                                type="button"
                                onClick={() => startRenameChecklistItem(cl.id, item)}
                                className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-indigo-500 transition-colors shrink-0"
                                title="Rename item"
                              >
                                <IconPencilSmall />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteChecklistItem(cl.id, item.id)}
                                className="opacity-0 group-hover:opacity-100 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors shrink-0"
                                title="Delete checklist item"
                              >
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                              </button>
                            </>
                          )}
                        </div>
                      ))}

                      {/* Add item to checklist */}
                      {addingChecklistItem === cl.id ? (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="text"
                            value={newChecklistItemText}
                            onChange={(e) => setNewChecklistItemText(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddChecklistItem(cl.id); if (e.key === 'Escape') setAddingChecklistItem(null); }}
                            placeholder="Item name"
                            autoFocus
                            className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md px-2 py-1 outline-none focus:border-indigo-400 bg-transparent dark:text-gray-300"
                            title="Item name"
                          />
                          <button onClick={() => handleAddChecklistItem(cl.id)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">Add</button>
                          <button onClick={() => setAddingChecklistItem(null)} className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">Cancel</button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!canUpdateTaskDetails) return;
                            setEditingChecklistId(null);
                            setEditingChecklistName('');
                            setAddingChecklistItem(cl.id);
                            setNewChecklistItemText('');
                          }}
                          className={`flex items-center gap-1 text-xs mt-2 ${canUpdateTaskDetails ? 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300' : 'hidden'}`}
                          title="Add item"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                          Add item
                        </button>
                      )}
                    </div>
                  );
                })}

                {/* Create checklist */}
                {canUpdateTaskDetails && (addingChecklist ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newChecklistName}
                      onChange={(e) => setNewChecklistName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreateChecklist(); if (e.key === 'Escape') setAddingChecklist(false); }}
                      placeholder="Checklist name"
                      autoFocus
                      className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-md px-3 py-1.5 outline-none focus:border-indigo-400 bg-transparent dark:text-gray-300"
                      title="Checklist name"
                    />
                    <button
                      onClick={handleCreateChecklist}
                      disabled={!newChecklistName.trim()}
                      className="px-3 py-1.5 bg-indigo-500 text-white text-xs rounded-md hover:bg-indigo-600 disabled:opacity-50"
                    >
                      Create
                    </button>
                    <button onClick={() => setAddingChecklist(false)} className="px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingChecklist(true); setNewChecklistName(''); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-300"
                    title="Create checklist"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
                    Create checklist
                  </button>
                ))}
              </div>

              <AttachmentSection ref={attachmentRef} taskId={id!} canEdit={!isReadOnly} />
            </div>
          </div>
        </div>

        {/* ══════════ Right Sidebar: Activity & Likes ══════════ */}
        <div
          className={`relative ${stackVertical ? 'w-full border-l-0 border-t' : 'lg:w-[400px] border-l lg:flex-initial'} shrink-0 flex-col bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 flex-1 min-h-0 ${mobileTab === 'activity' ? (stackVertical ? 'flex' : 'flex lg:flex') : (stackVertical ? 'hidden' : 'hidden lg:flex')}`}
        >
          {/* Sidebar Tabs */}
          <div className="flex items-center gap-6 px-5 border-b border-gray-200 dark:border-gray-700 h-[45px] shrink-0">
            <button
              onClick={() => setSidebarTab('activity')}
              className={`h-full text-[13px] font-bold transition-all relative ${sidebarTab === 'activity' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Activity
              {sidebarTab === 'activity' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />}
            </button>
            <button
              onClick={() => setSidebarTab('likes')}
              className={`h-full text-[13px] font-bold transition-all relative ${sidebarTab === 'likes' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Likes
              {sidebarTab === 'likes' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />}
            </button>
            <button
              onClick={() => setSidebarTab('attachments')}
              className={`h-full text-[13px] font-bold transition-all relative ${sidebarTab === 'attachments' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Attachments
              {sidebarTab === 'attachments' && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 rounded-t-full" />}
            </button>
          </div>

          {/* Sidebar Tab Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {sidebarTab === 'activity' && (
              <>
                {/* Sidebar header - Compact */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-900/30 min-h-[40px]">
                  {showCommentSearch ? (
                    <div className="flex-1 flex items-center gap-2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-400"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                      <input
                        type="text"
                        autoFocus
                        placeholder="Search comments..."
                        value={commentSearch}
                        onChange={(e) => setCommentSearch(e.target.value)}
                        className="flex-1 bg-transparent text-xs outline-none text-gray-700 dark:text-gray-300"
                        title="Search comments"
                      />
                      <button
                        onClick={() => { setShowCommentSearch(false); setCommentSearch(''); }}
                        className="p-1 text-gray-400 hover:text-red-500"
                        title="Clear search"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <div />
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowCommentSearch(true)} className="p-1 text-gray-400 hover:text-gray-600" title="Search activity">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
                  <div className="space-y-4">
                    {(() => {
                      if (feedGroups.length === 0 && !loading) return <div className="text-center py-12 text-xs text-gray-400 dark:text-gray-500">No activity found</div>;

                      return feedGroups.map((group: any, gIdx: number) => {
                        if (group.type === 'commentGroup') {
                          return (
                            <div key={group.createdAt + gIdx} className="group-card bg-gray-50/50 dark:bg-gray-800/20 rounded-2xl border border-gray-100 dark:border-gray-800 p-4 transition-all hover:shadow-sm min-w-0 max-w-full">
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2.5">
                                  <UserAvatar
                                    user={group.user}
                                    className="w-8 h-8 rounded-full object-cover shadow-sm transition-transform hover:scale-105"
                                    fallbackClassName="w-8 h-8 rounded-full bg-indigo-500 text-white text-[11px] font-bold flex items-center justify-center shadow-sm"
                                  />
                                  <div>
                                    <div className="text-[13px] text-gray-900 dark:text-white font-bold leading-tight">{group.user.firstName} {group.user.lastName}</div>
                                    <div className="text-[11px] text-gray-400 dark:text-gray-500">{new Date(group.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
                                  </div>
                                </div>
                              </div>

                              <div className="pl-[38px] space-y-4 min-w-0">
                                {group.items.map((c: any) => {
                                  const structuredDoc = c.text && isStructuredCommentText(c.text) ? parseCommentDoc(c.text) : null;
                                  const filesOrdered = commentFilesInOrder(c as Comment);
                                  const canDelAtt = !!(isAdmin || (currentUser && (c.userId === currentUser.id || c.user?.id === currentUser.id)));
                                  return (
                                  <div key={c.id} id={`comment-${c.id}`} className="relative group scroll-mt-10 min-w-0 max-w-full">
                                    {structuredDoc ? (
                                      <CommentStructuredBody
                                        doc={structuredDoc}
                                        files={filesOrdered}
                                        searchQuery={commentSearch}
                                        mentionNames={mentionNames}
                                        onPreview={(url, name) => setPreviewImage({ url, name })}
                                        onDeleteFile={(fileUrl, fileName) =>
                                          setConfirmRemoveAttachment({ commentId: c.id, fileUrl, fileName })
                                        }
                                        canDelete={canDelAtt}
                                      />
                                    ) : (
                                      <>
                                        <CommentText
                                          text={c.text || ''}
                                          searchQuery={commentSearch}
                                          mentionNames={mentionNames}
                                        />
                                        {(c.fileUrl || (Array.isArray(c.attachments) && c.attachments.length > 0)) && (
                                          <div className="mt-3 space-y-3">
                                            {c.fileUrl && (
                                              <CommentFilePreview
                                                name={c.fileName || 'file'}
                                                size={c.fileSize}
                                                type={c.fileType}
                                                url={c.fileUrl}
                                                onPreview={(url, name) => setPreviewImage({ url, name })}
                                                onDelete={() =>
                                                  setConfirmRemoveAttachment({
                                                    commentId: c.id,
                                                    fileUrl: c.fileUrl!,
                                                    fileName: c.fileName || undefined,
                                                  })
                                                }
                                                canDelete={canDelAtt}
                                              />
                                            )}
                                            {Array.isArray(c.attachments) &&
                                              c.attachments.map((att: CommentAttachment, attIdx: number) => (
                                                <CommentFilePreview
                                                  key={`${c.id}-att-${attIdx}`}
                                                  name={att.fileName || 'file'}
                                                  size={att.fileSize}
                                                  type={att.fileType}
                                                  url={att.fileUrl}
                                                  onPreview={(url, name) => setPreviewImage({ url, name })}
                                                  onDelete={() =>
                                                    setConfirmRemoveAttachment({
                                                      commentId: c.id,
                                                      fileUrl: att.fileUrl,
                                                      fileName: att.fileName || undefined,
                                                    })
                                                  }
                                                  canDelete={canDelAtt}
                                                />
                                              ))}
                                          </div>
                                        )}
                                      </>
                                    )}

                                    <div className="absolute top-0 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg p-0.5 border border-gray-100 dark:border-gray-700 shadow-sm">
                                      {(isAdmin || (currentUser && (c.userId === currentUser.id || c.user?.id === currentUser.id))) && (
                                        <button
                                          onClick={() => setConfirmDeleteCommentId(c.id)}
                                          className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                          title="Delete message"
                                        >
                                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                                        </button>
                                      )}
                                    </div>

                                    {reactions[c.id]?.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mt-2">
                                        {reactions[c.id].map((em: string, i: number) => (
                                          <span key={i} className="px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-[10px] border border-indigo-100 dark:border-indigo-800">{em}</span>
                                        ))}
                                      </div>
                                    )}

                                    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 dark:border-gray-800/50">
                                      <button
                                        onClick={() => toggleLike(c.id)}
                                        className={`flex items-center gap-1.5 transition-colors ${likedComments.has(c.id) ? 'text-indigo-600 font-bold' : 'text-gray-400 hover:text-indigo-500'}`}
                                        title={likedComments.has(c.id) ? 'Unlike comment' : 'Like comment'}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill={likedComments.has(c.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" /></svg>
                                        <span className="text-[11px] font-medium">{likedComments.has(c.id) ? 'Liked' : 'Like'}</span>
                                      </button>
                                      <button
                                        onClick={() => addReaction(c.id, '👍')}
                                        className="flex items-center gap-1.5 text-gray-400 hover:text-yellow-500 transition-colors"
                                        title="Add reaction"
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        <span className="text-[11px] font-medium">Reaction</span>
                                      </button>
                                      <button
                                        onClick={() => {
                                          setReplyingTo(c);
                                          const fullName = `${c.user.firstName || ''}${c.user.lastName ? ` ${c.user.lastName}` : ''}`.trim();
                                          const nid = generateId();
                                          setCommentBlocks([{ id: nid, kind: 'text', text: fullName ? `@${fullName} ` : '' }]);
                                          setMentionBlockId(nid);
                                          window.setTimeout(() => commentBlockTextareaRefs.current[nid]?.focus(), 50);
                                        }}
                                        className="ml-auto text-indigo-500 hover:text-indigo-600 text-[11px] font-bold"
                                      >
                                        Reply
                                      </button>
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        } else {
                          return <ActivityItem key={group.id} activity={group} />;
                        }
                      });
                    })()}
                  </div>
                </div>
              </>
            )}

            {sidebarTab === 'likes' && (
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="bg-pink-50/50 dark:bg-pink-900/10 border border-pink-100 dark:border-pink-800 rounded-xl p-4 mb-6">
                  <h4 className="text-sm font-bold text-pink-600 dark:text-pink-400 mb-1">Task Appreciation</h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">See everyone who liked this task and its conversation.</p>
                </div>

                <div className="space-y-4">
                  {likedComments.size > 0 ? (
                    Array.from(likedComments).map(commentId => {
                      const c = comments.find(x => x.id === commentId);
                      if (!c) return null;
                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSidebarTab('activity');
                            setTimeout(() => {
                              document.getElementById(`comment-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }, 100);
                          }}
                          className="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm cursor-pointer hover:border-pink-300 dark:hover:border-pink-800 transition-all hover:shadow-md"
                        >
                          <UserAvatar
                            user={c.user}
                            className="w-8 h-8 rounded-full object-cover"
                            fallbackClassName="w-8 h-8 rounded-full bg-pink-500 text-white text-[10px] font-bold flex items-center justify-center"
                          />
                          <div>
                            <div className="text-[13px] font-bold text-gray-900 dark:text-white">{c.user.firstName} {c.user.lastName}</div>
                            <div className="text-[10px] text-gray-400">Liked a comment</div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 text-sm text-gray-400">No likes yet. Be the first! ❤️</div>
                  )}
                </div>
              </div>
            )}

            {sidebarTab === 'attachments' && (
              <div className="flex-1 overflow-y-auto px-5 py-5">
                <div className="bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 mb-6">
                  <h4 className="text-sm font-bold text-indigo-600 dark:text-indigo-400 mb-1">Task Attachments</h4>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">View and manage all files and images related to this task.</p>
                </div>

                <div className="space-y-4">
                  <AttachmentSection
                    ref={sidebarAttachmentRef}
                    taskId={id!}
                    canEdit={canUpdateTaskDetails}
                    isSidebar={true}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Comment input - bottom */}
          {canAddComments ? (
            <div
              className="border-t border-gray-200 dark:border-gray-700 p-3 mt-auto bg-white dark:bg-gray-900 relative"
              onDragEnter={(e) => {
                e.stopPropagation();
                if (e.dataTransfer.types.includes('Files')) {
                  e.preventDefault();
                  commentDragCounter.current++;
                  setCommentDragging(true);
                }
              }}
              onDragLeave={(e) => {
                e.stopPropagation();
                commentDragCounter.current--;
                if (commentDragCounter.current === 0) setCommentDragging(false);
              }}
              onDragOver={(e) => {
                e.stopPropagation();
                if (e.dataTransfer.types.includes('Files')) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                commentDragCounter.current = 0;
                setCommentDragging(false);
                if (!canAddComments) return;
                const dropped = Array.from(e.dataTransfer.files || []);
                if (dropped.length) {
                  const accepted: File[] = [];
                  const rejected: File[] = [];
                  for (const file of dropped) {
                    if (file.size > COMMENT_INPUT_MAX_FILE_BYTES) rejected.push(file);
                    else accepted.push(file);
                  }
                  if (rejected.length > 0) {
                    const maxMb = (COMMENT_INPUT_MAX_FILE_BYTES / (1024 * 1024)).toFixed(0);
                    alert(
                      rejected.length === 1
                        ? `"${rejected[0].name}" exceeds the ${maxMb}MB limit.`
                        : `${rejected.length} file(s) exceed the ${maxMb}MB limit.`
                    );
                  }
                  if (accepted.length > 0) {
                    const additions: PendingCommentFile[] = accepted.map((file) => ({
                      id: generateId(),
                      file,
                      preview: null,
                    }));
                    appendPendingFilesToDraft(additions);
                  }
                  setSidebarTab('activity');
                }
              }}
            >
              {/* Input-only drag overlay */}
              {commentDragging && (
                <div className="absolute inset-0 z-[200] pointer-events-none flex flex-col items-center justify-center border-2 border-dashed border-indigo-400 bg-indigo-50/90 dark:bg-indigo-900/50 backdrop-blur-[2px] rounded-t-none">
                  <div className="flex flex-col items-center gap-3 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-800/60 flex items-center justify-center shadow-lg">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-indigo-500">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                      </svg>
                    </div>
                    <p className="text-base font-bold text-indigo-600 dark:text-indigo-300">Drop to attach files</p>
                    <p className="text-xs text-indigo-400">Files will be added to your comment</p>
                  </div>
                </div>
              )}
              {replyingTo && (
                <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-800 rounded-t-lg border-x border-t border-gray-200 dark:border-gray-700 text-[11px]">
                  <span className="text-gray-500">Replying to <span className="font-bold text-indigo-500">{replyingTo.user.firstName}</span></span>
                  <button onClick={() => setReplyingTo(null)} className="text-gray-400 hover:text-red-500" title="Cancel reply"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg></button>
                </div>
              )}
              <div className={`relative flex flex-col border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-visible ${replyingTo ? 'rounded-b-lg' : 'rounded-lg'}`}>
                {showMentions && (
                  <div ref={mentionRef} className="absolute bottom-full left-0 right-0 mb-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl max-h-[200px] overflow-y-auto">
                    <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">People</span>
                    </div>
                    {filteredMentionMembers.length > 0 ? (
                      filteredMentionMembers.map((m, idx) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => insertMention(m)}
                          className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors text-left ${idx === mentionIndex ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
                          title={`Mention ${m.firstName}`}
                        >
                          <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                            {m.firstName?.[0]}{m.lastName?.[0]}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-bold text-gray-700 dark:text-gray-200 truncate">{m.firstName} {m.lastName}</p>
                            <p className="text-[10px] text-gray-400 truncate">{m.email}</p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                        No people available to mention.
                      </div>
                    )}
                  </div>
                )}
                <div className="max-h-[min(48vh,320px)] overflow-y-auto px-2 py-2 space-y-2 bg-gray-50/60 dark:bg-gray-900/25">
                  {commentBlocks.map((block) =>
                    block.kind === 'text' ? (
                      <textarea
                        key={block.id}
                        ref={(el) => {
                          commentBlockTextareaRefs.current[block.id] = el;
                        }}
                        value={block.text}
                        onChange={(e) => {
                          handleCommentBlockChange(block.id, e.target.value);
                          const el = e.target;
                          el.style.height = 'auto';
                          el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
                        }}
                        onFocus={() => setMentionBlockId(block.id)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (showMentions && filteredMentionMembers.length > 0) {
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              setMentionIndex((prev) => (prev + 1) % filteredMentionMembers.length);
                              return;
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              setMentionIndex((prev) => (prev - 1 + filteredMentionMembers.length) % filteredMentionMembers.length);
                              return;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                              e.preventDefault();
                              insertMention(filteredMentionMembers[mentionIndex]);
                              return;
                            }
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              setShowMentions(false);
                              return;
                            }
                          }
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handlePostComment();
                          }
                        }}
                        placeholder="Write a comment... (type @ to mention)"
                        disabled={isPostingComment}
                        rows={2}
                        className="w-full min-h-[72px] max-h-[220px] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 outline-none resize-none disabled:opacity-50 overflow-y-auto"
                        title="Write a comment"
                      />
                    ) : (
                      <div
                        key={block.id}
                        className="relative rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm overflow-hidden max-w-[220px]"
                      >
                        {block.pending.preview ? (
                          <img src={block.pending.preview} alt="" className="h-28 w-full object-cover block" />
                        ) : (
                          <div className="h-28 flex flex-col items-center justify-center gap-1 px-2 bg-indigo-50/80 dark:bg-indigo-900/20">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-500 shrink-0">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 truncate max-w-full px-1">{block.pending.file.name}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFileDraftBlock(block.id)}
                          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-md bg-black/55 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                          title="Remove"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                        </button>
                        {block.pending.preview && (
                          <div className="absolute bottom-0 left-0 right-0 px-2 py-0.5 bg-black/55">
                            <p className="text-[10px] font-medium text-white truncate">{block.pending.file.name}</p>
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-gray-100 dark:border-gray-700 px-2 py-1.5 bg-white dark:bg-gray-800">
                  {!isReadOnly && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <input
                        type="file"
                        ref={imageInputRef}
                        className="sr-only"
                        accept="image/*"
                        multiple
                        onChange={handleFileUpload}
                        title="Add images"
                      />
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="sr-only"
                        multiple
                        onChange={handleFileUpload}
                        title="Attach files"
                      />
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        disabled={isUploading || isPostingComment}
                        className={`text-gray-500 dark:text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700/80 p-1.5 rounded-lg transition-colors ${isUploading || isPostingComment ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Add images"
                      >
                        <IconImagePlus />
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading || isPostingComment}
                        className={`text-gray-500 dark:text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-gray-100 dark:hover:bg-gray-700/80 p-1.5 rounded-lg transition-colors ${isUploading || isPostingComment ? 'opacity-50 cursor-not-allowed' : ''}`}
                        title="Attach files"
                      >
                        {isUploading ? (
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <IconPaperclip />
                        )}
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                    <button type="button" className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 p-1" title="More options">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                    </button>
                    <button
                      type="button"
                      onClick={handlePostComment}
                      disabled={!blocksHasContent() || isPostingComment}
                      className={`${blocksHasContent() && !isPostingComment ? 'text-indigo-500 hover:text-indigo-600' : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'}`}
                      title="Send message"
                    >
                      {isPostingComment ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <IconSend />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-xs text-gray-400 dark:text-gray-500 border-t border-gray-200 dark:border-gray-700">
              View-only mode. You cannot post comments.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {content}
      {previewImage && (
        <ImagePreview
          src={previewImage.url}
          alt={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDeleteCommentId}
        title="Are you sure?"
        description="Do you want to delete this comment?"
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        isBusy={isDeletingComment}
        onClose={() => { if (!isDeletingComment) setConfirmDeleteCommentId(null); }}
        onConfirm={() => { if (confirmDeleteCommentId) deleteComment(confirmDeleteCommentId).finally(() => setConfirmDeleteCommentId(null)); }}
      />

      <ConfirmDialog
        open={!!confirmRemoveAttachment}
        title="Are you sure?"
        description={
          confirmRemoveAttachment?.fileName
            ? `Do you want to delete "${confirmRemoveAttachment.fileName}"?`
            : 'Do you want to delete this attachment?'
        }
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        isBusy={isRemovingAttachment}
        onClose={() => { if (!isRemovingAttachment) setConfirmRemoveAttachment(null); }}
        onConfirm={() => {
          if (!confirmRemoveAttachment) return;
          removeCommentAttachment(confirmRemoveAttachment.commentId, confirmRemoveAttachment.fileUrl)
            .finally(() => setConfirmRemoveAttachment(null));
        }}
      />

      <ConfirmDialog
        open={confirmDeleteTaskOpen}
        title="Are you sure?"
        description={task?.title ? `Do you want to delete "${task.title}"?` : 'Do you want to delete this task?'}
        confirmText="Delete"
        cancelText="Cancel"
        tone="danger"
        isBusy={isDeletingTask}
        onClose={() => { if (!isDeletingTask) setConfirmDeleteTaskOpen(false); }}
        onConfirm={performDeleteTask}
      />
    </>
  );
}
