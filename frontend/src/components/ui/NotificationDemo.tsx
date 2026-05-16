import { useToast } from './Toast';

/**
 * Enhanced Notification Demo
 * Shows how to use the new notification system with:
 * - Sender avatar and name
 * - Website/app icon
 * - Custom title
 * - Different notification types
 */
export function NotificationDemo() {
  const { notification, success, error, warning, info } = useToast();

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-2xl font-bold mb-6">Notification Examples</h2>

      {/* Example 1: Rich Notification with Sender */}
      <button
        onClick={() =>
          notification('You have been assigned a new task: "Design system update" with deadline tomorrow.', {
            sender: {
              name: 'Sarah Anderson',
              avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah',
            },
            websiteIcon: 'https://api.dicebear.com/7.x/initials/svg?seed=PT',
            websiteName: 'Producteev',
            title: 'New Task Assignment',
            duration: 6000,
          })
        }
        className="w-full p-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
      >
        📬 Task Assignment Notification
      </button>

      {/* Example 2: Chat Notification */}
      <button
        onClick={() =>
          notification('Hey, are we still meeting at 3 PM today?', {
            sender: {
              name: 'John Smith',
              avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=John',
            },
            websiteIcon: 'https://api.dicebear.com/7.x/initials/svg?seed=Chat',
            websiteName: 'Team Chat',
            title: 'New Message',
            duration: 5000,
          })
        }
        className="w-full p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        💬 Chat Message Notification
      </button>

      {/* Example 3: Mention Notification */}
      <button
        onClick={() =>
          notification('mentioned you in the "Project Q1" task comment.', {
            sender: {
              name: 'Emma Wilson',
              avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emma',
            },
            websiteIcon: 'https://api.dicebear.com/7.x/initials/svg?seed=PT',
            websiteName: 'Producteev',
            title: 'You were mentioned',
            duration: 5000,
          })
        }
        className="w-full p-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
      >
        🏷️ Mention Notification
      </button>

      {/* Example 4: File Share Notification */}
      <button
        onClick={() =>
          notification('shared "Q1_Marketing_Report.pdf" with you', {
            sender: {
              name: 'Michael Chen',
              avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Michael',
            },
            websiteIcon: 'https://api.dicebear.com/7.x/initials/svg?seed=Drive',
            websiteName: 'File Sharing',
            title: 'New File Shared',
            duration: 5000,
          })
        }
        className="w-full p-3 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
      >
        📄 File Share Notification
      </button>

      {/* Example 5: Comment Notification */}
      <button
        onClick={() =>
          notification('commented on your task: "Great work on the design mockups!"', {
            sender: {
              name: 'Lisa Park',
              avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Lisa',
            },
            websiteIcon: 'https://api.dicebear.com/7.x/initials/svg?seed=PT',
            websiteName: 'Producteev',
            title: 'New Comment',
            duration: 5000,
          })
        }
        className="w-full p-3 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
      >
        💭 Comment Notification
      </button>

      <hr className="my-6" />

      {/* Simple Notifications */}
      <h3 className="text-xl font-bold mt-6 mb-4">Simple Notifications</h3>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => success('Changes saved successfully!')}
          className="p-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          ✓ Success
        </button>

        <button
          onClick={() => error('Failed to update the task.')}
          className="p-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          ✕ Error
        </button>

        <button
          onClick={() => warning('This action cannot be undone.')}
          className="p-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
        >
          ⚠️ Warning
        </button>

        <button
          onClick={() => info('New features are available.')}
          className="p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          ℹ️ Info
        </button>
      </div>
    </div>
  );
}
