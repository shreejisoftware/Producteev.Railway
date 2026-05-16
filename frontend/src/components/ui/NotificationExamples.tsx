import { useEffect } from 'react';
import { useToast } from './Toast';
import { useAppSelector } from '../../store';

/**
 * Real-world Integration Examples
 * Shows how to use enhanced notifications with actual app data
 */

// ─── Task Assignment Notification ───
export function TaskAssignmentNotification({ task, assignedBy }: { task: any; assignedBy: any }) {
  const { notification } = useToast();

  const notifyTaskAssignment = () => {
    notification(
      `Assigned to you: "${task.title}" - Due ${formatDate(task.dueDate)}`,
      {
        sender: {
          name: `${assignedBy.firstName} ${assignedBy.lastName}`,
          avatar: assignedBy.avatarUrl,
        },
        websiteIcon: 'ttps://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: 'New Task Assignment',
        action: {
          label: 'Open Task',
          onClick: () => window.location.href = `/tasks/${task.id}`,
        },
      }
    );
  };

  return (
    <button onClick={notifyTaskAssignment} className="px-4 py-2 bg-blue-600 text-white rounded">
      Notify Task Assignment
    </button>
  );
}

// ─── Comment Notification ───
export function CommentNotification({ task, commenter, comment }: any) {
  const { notification } = useToast();

  const notifyComment = () => {
    notification(
      `commented: "${comment.content.substring(0, 50)}..."`,
      {
        sender: {
          name: `${commenter.firstName} ${commenter.lastName}`,
          avatar: commenter.avatarUrl,
        },
        websiteIcon: 'ttps://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: `Comment on "${task.title}"`,
        duration: 5000,
        action: {
          label: 'View',
          onClick: () => window.location.href = `/tasks/${task.id}#comment-${comment.id}`,
        },
      }
    );
  };

  return (
    <button onClick={notifyComment} className="px-4 py-2 bg-purple-600 text-white rounded">
      Notify Comment
    </button>
  );
}

// ─── Mention Notification ───
export function MentionNotification({ mentioner, context, contextUrl }: any) {
  const { notification } = useToast();

  const notifyMention = () => {
    notification(
      `mentioned you in "${context}"`,
      {
        sender: {
          name: `${mentioner.firstName} ${mentioner.lastName}`,
          avatar: mentioner.avatarUrl,
        },
        websiteIcon: 'ttps://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: 'You were mentioned',
        duration: 5000,
        action: {
          label: 'View',
          onClick: () => window.location.href = contextUrl,
        },
      }
    );
  };

  return (
    <button onClick={notifyMention} className="px-4 py-2 bg-pink-600 text-white rounded">
      Notify Mention
    </button>
  );
}

// ─── Chat Message Notification ───
export function ChatMessageNotification({ sender, message }: any) {
  const { notification } = useToast();

  const notifyChatMessage = () => {
    notification(
      message.content.length > 80 ? `${message.content.substring(0, 77)}...` : message.content,
      {
        sender: {
          name: `${sender.firstName} ${sender.lastName}`,
          avatar: sender.avatarUrl,
        },
        websiteIcon: '/chat-icon.png',
        websiteName: 'Team Chat',
        title: 'New Message',
        duration: 4000,
        action: {
          label: 'Reply',
          onClick: () => window.location.href = `/chat/${sender.id}`,
        },
      }
    );
  };

  return (
    <button onClick={notifyChatMessage} className="px-4 py-2 bg-blue-600 text-white rounded">
      Notify Chat Message
    </button>
  );
}

// ─── File Share Notification ───
export function FileShareNotification({ sharedBy, fileName, fileSize }: any) {
  const { notification } = useToast();

  const notifyFileShare = () => {
    notification(
      `shared "${fileName}" (${formatFileSize(fileSize)})`,
      {
        sender: {
          name: `${sharedBy.firstName} ${sharedBy.lastName}`,
          avatar: sharedBy.avatarUrl,
        },
        websiteIcon: '/files-icon.png',
        websiteName: 'Files',
        title: 'File Shared',
        duration: 5000,
        action: {
          label: 'Download',
          onClick: () => downloadFile(fileName),
        },
      }
    );
  };

  return (
    <button onClick={notifyFileShare} className="px-4 py-2 bg-orange-600 text-white rounded">
      Notify File Share
    </button>
  );
}

// ─── Task Status Change Notification ───
export function TaskStatusChangeNotification({ task, changedBy, newStatus }: any) {
  const { notification } = useToast();

  const statusEmoji = {
    'todo': '📋',
    'in-progress': '⚙️',
    'completed': '✅',
    'archived': '📦',
  };

  const notifyStatusChange = () => {
    notification(
      `changed "${task.title}" to ${newStatus}`,
      {
        sender: {
          name: `${changedBy.firstName} ${changedBy.lastName}`,
          avatar: changedBy.avatarUrl,
        },
        websiteIcon: 'ttps://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: `${statusEmoji[newStatus as keyof typeof statusEmoji] || '📝'} Status Updated`,
        duration: 4000,
        action: {
          label: 'View',
          onClick: () => window.location.href = `/tasks/${task.id}`,
        },
      }
    );
  };

  return (
    <button onClick={notifyStatusChange} className="px-4 py-2 bg-green-600 text-white rounded">
      Notify Status Change
    </button>
  );
}

// ─── Deadline Reminder Notification ───
export function DeadlineReminderNotification({ task }: any) {
  const { notification } = useToast();

  const notifyDeadline = () => {
    const hoursUntil = Math.floor(
      (new Date(task.dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60)
    );

    notification(
      `"${task.title}" is due in ${hoursUntil} hour${hoursUntil !== 1 ? 's' : ''}`,
      {
        sender: {
          name: 'Producteev',
          avatar: undefined, // System notification, no sender avatar
        },
        websiteIcon: 'ttps://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: '⏰ Deadline Reminder',
        duration: 6000,
        action: {
          label: 'Start Task',
          onClick: () => window.location.href = `/tasks/${task.id}`,
        },
      }
    );
  };

  return (
    <button onClick={notifyDeadline} className="px-4 py-2 bg-red-600 text-white rounded">
      Notify Deadline
    </button>
  );
}

// ─── Collaboration Notification ───
export function CollaborationNotification({ user, action, itemName }: any) {
  const { notification } = useToast();

  const actionMessages = {
    'started-working': 'started working on',
    'stopped-working': 'stopped working on',
    'joined': 'joined',
    'left': 'left',
    'completed': 'completed',
  };

  const notifyCollaboration = () => {
    notification(
      `${actionMessages[action as keyof typeof actionMessages] || action} "${itemName}"`,
      {
        sender: {
          name: `${user.firstName} ${user.lastName}`,
          avatar: user.avatarUrl,
        },
        websiteIcon: 'https://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
        websiteName: 'Producteev',
        title: 'Collaboration Update',
        duration: 4000,
      }
    );
  };

  return (
    <button onClick={notifyCollaboration} className="px-4 py-2 bg-indigo-600 text-white rounded">
      Notify Collaboration
    </button>
  );
}

// ─── Helper Functions ───
function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function downloadFile(fileName: string): void {
  // Implement actual file download logic
  console.log(`Downloading ${fileName}`);
}

// ─── Hook for Real-time Notifications from WebSocket/API ───
export function useRealtimeNotifications() {
  const { notification, success, error } = useToast();
  const currentUser = useAppSelector(state => state.user.currentUser);

  useEffect(() => {
    // Example: Subscribe to real-time events
    const handleTaskAssigned = (event: any) => {
      notification(
        `Task: "${event.task.title}" - Due: ${formatDate(event.task.dueDate)}`,
        {
          sender: {
            name: `${event.assignedBy.firstName} ${event.assignedBy.lastName}`,
            avatar: event.assignedBy.avatarUrl,
          },
          websiteIcon: 'https://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
          websiteName: 'Producteev',
          title: 'New Task Assignment',
          action: {
            label: 'Open Task',
            onClick: () => window.location.href = `/tasks/${event.task.id}`,
          },
        }
      );
    };

    const handleCommentAdded = (event: any) => {
      notification(
        `commented: "${event.comment.content.substring(0, 50)}..."`,
        {
          sender: {
            name: `${event.commenter.firstName} ${event.commenter.lastName}`,
            avatar: event.commenter.avatarUrl,
          },
          websiteIcon: 'https://raw.githubusercontent.com/shreejisoftware/Producteev/Producteev/frontend/src/components/layout/website%20name.png',
          websiteName: 'Producteev',
          title: `Comment on "${event.task.title}"`,
          action: {
            label: 'View',
            onClick: () => window.location.href = `/tasks/${event.task.id}#comment-${event.comment.id}`,
          },
        }
      );
    };

    // Attach listeners (replace with actual websocket/event emitter)
    // eventEmitter.on('task-assigned', handleTaskAssigned);
    // eventEmitter.on('comment-added', handleCommentAdded);

    // Cleanup
    return () => {
      // eventEmitter.off('task-assigned', handleTaskAssigned);
      // eventEmitter.off('comment-added', handleCommentAdded);
    };
  }, [notification, currentUser]);
}
