import { User } from './user.types';

export type TaskStatus = 'OPEN' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'IN_REVIEW' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  checklistId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Checklist {
  id: string;
  name: string;
  taskId: string;
  items: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  startDate: string | null;
  dueDate: string | null;
  timeEstimate?: number | null;
  projectId: string;
  listId?: string | null;
  parentTaskId?: string | null;
  assigneeIds: string[];
  createdById: string;
  createdAt: string;
  updatedAt: string;
  assignees: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'avatarUrl'>[];
  createdBy: Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'avatarUrl'>;
  project?: {
    id: string;
    name: string;
    organizationId?: string;
  };
  list?: {
    id: string;
    name: string;
    space?: {
      id: string;
      name: string;
      organizationId: string;
    } | null;
    folder?: {
      id: string;
      name: string;
    } | null;
  } | null;
  tags?: Tag[];
  subtasks?: Task[];
  checklists?: Checklist[];
  isFavorite: boolean;
}

export type Subtask = Task;

export interface CreateTaskRequest {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  startDate?: string;
  dueDate?: string;
  timeEstimate?: number;
  isFavorite?: boolean;
  projectId: string;
  listId?: string;
  parentTaskId?: string;
  assigneeIds?: string[];
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  startDate?: string | null;
  dueDate?: string | null;
  timeEstimate?: number | null;
  assigneeIds?: string[] | null;
  listId?: string | null;
  parentTaskId?: string | null;
  tagIds?: string[] | null;
  isFavorite?: boolean;
}

export interface DashboardStats {
  projectCount: number;
  listCount: number;
  taskCount: number;
  openTaskCount?: number;
  completedTaskCount?: number;
  unassignedOpenTaskCount?: number;
  memberCount: number;
  recentTasks: Task[];
  openTasksPreview?: { id: string; title: string; status?: TaskStatus; updatedAt?: string }[];
  unassignedOpenTasksPreview?: { id: string; title: string; status?: TaskStatus; updatedAt?: string }[];
  members?: { id: string; name: string; avatarUrl: string | null }[];
  storageUsedBytes?: number;
  attachmentCount?: number;
  totalStorageUsedBytes?: number;
  totalAttachmentCount?: number;
}
