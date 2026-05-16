import { prisma } from '../config/database';
import { getIO } from '../socket/index';
import { OrgRole } from '@prisma/client';

export class NotificationService {
  static async create(userId: string, title: string, message: string, link?: string, organizationId?: string, senderAvatarUrl?: string, senderId?: string) {
    const notification = await prisma.notification.create({
      data: {
        userId,
        organizationId,
        title,
        message,
        link,
        senderAvatarUrl,
        senderId,
      } as any,
    });

    // Send real-time notification
    try {
      getIO().to(`user:${userId}`).emit('notification:new', notification);
    } catch (e) {
      console.warn('Socket not initialized, skipping realtime notification');
    }

    return notification;
  }

  /**
   * Notifies organization owners, admins, and task assignees about a task activity.
   */
  /**
   * Notifies organization owners, admins, and task assignees about a task activity.
   */
  static async notifyTaskActivity(taskId: string, actorId: string, actorRole: OrgRole, title: string, message: string) {
    try {
      // 1. Get task details and actor avatar in parallel
      const [task, actor] = await Promise.all([
        prisma.task.findUnique({
          where: { id: taskId },
          include: {
            assignees: { select: { id: true } },
            project: { select: { organizationId: true } },
            list: {
              select: {
                space: { select: { organizationId: true } }
              }
            }
          }
        }),
        actorId ? prisma.user.findUnique({ where: { id: actorId }, select: { avatarUrl: true } }) : null,
      ]);

      if (!task) return [];

      const orgId = task.project?.organizationId || task.list?.space?.organizationId;
      if (!orgId) return [];

      const actorAvatarUrl = actor?.avatarUrl ?? undefined;

      // 2. Collect all unique recipient IDs - batch org queries
      const recipientIds = new Set<string>();

      const memberQueries: Promise<{ userId: string }[]>[] = [
        // Rule: Owners and Admins always get notified
        prisma.organizationMember.findMany({
          where: { organizationId: orgId, role: { in: [OrgRole.ADMIN] } },
          select: { userId: true }
        }),
      ];

      // Rule: If actor is LIMITED_MEMBER, notify all standard Members too
      if (actorRole === OrgRole.LIMITED_MEMBER) {
        memberQueries.push(
          prisma.organizationMember.findMany({
            where: { organizationId: orgId, role: OrgRole.MEMBER },
            select: { userId: true }
          })
        );
      }

      // Rule: List members
      if (task.listId) {
        memberQueries.push(
          prisma.listMember.findMany({
            where: { listId: task.listId },
            select: { userId: true }
          })
        );
      }

      const memberResults = await Promise.all(memberQueries);
      for (const members of memberResults) {
        members.forEach(m => recipientIds.add(m.userId));
      }

      // Rule: Assignees get notified for their specific tasks
      task.assignees.forEach(a => recipientIds.add(a.id));

      // Rule: Task Creator getting notified? Usually yes for visibility
      if (task.createdById) {
        recipientIds.add(task.createdById);
      }

      // Logic change: If the actor is an assignee, we KEEP them in the notification list
      // so the task remains in their "Assigned" inbox feed as per user request.
      const isActorAssignee = task.assignees.some(a => a.id === actorId);
      if (!isActorAssignee) {
        recipientIds.delete(actorId);
      }

      // 3. Dispatch notifications
      const link = `/tasks/${taskId}`;
      const results = await Promise.all(
        Array.from(recipientIds).map(userId =>
          this.create(userId, title, message, link, orgId, actorAvatarUrl, actorId)
        )
      );

      return results;
    } catch (error) {
      console.error('Failed to send task activity notifications:', error);
      return [];
    }
  }
  /**
   * Notifies all admins of an organization.
   */
  static async notifyAdmins(orgId: string, actorId: string, title: string, message: string, link?: string) {
    try {
      const admins = await prisma.organizationMember.findMany({
        where: { organizationId: orgId, role: OrgRole.ADMIN },
        select: { userId: true }
      });

      const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { avatarUrl: true } });
      const actorAvatarUrl = actor?.avatarUrl ?? undefined;

      return Promise.all(
        admins.filter(a => a.userId !== actorId).map(admin =>
          this.create(admin.userId, title, message, link, orgId, actorAvatarUrl, actorId)
        )
      );
    } catch (error) {
      console.error('Failed to notify admins:', error);
      return [];
    }
  }

  /**
   * Notifies all members (and admins) of an organization, excluding Limited Members.
   */
  static async notifyMembers(orgId: string, actorId: string, title: string, message: string, link?: string) {
    try {
      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId: orgId,
          role: { in: [OrgRole.ADMIN, OrgRole.MEMBER] }
        },
        select: { userId: true }
      });

      const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { avatarUrl: true } });
      const actorAvatarUrl = actor?.avatarUrl ?? undefined;

      return Promise.all(
        members.filter(m => m.userId !== actorId).map(member =>
          this.create(member.userId, title, message, link, orgId, actorAvatarUrl, actorId)
        )
      );
    } catch (error) {
      console.error('Failed to notify members:', error);
      return [];
    }
  }

  /**
   * Notifies a specific user.
   */
  static async notifyUser(targetUserId: string, actorId: string, title: string, message: string, link?: string, orgId?: string) {
    try {
      const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { avatarUrl: true } });
      const actorAvatarUrl = actor?.avatarUrl ?? undefined;

      return this.create(targetUserId, title, message, link, orgId, actorAvatarUrl, actorId);
    } catch (error) {
      console.error('Failed to notify specific user:', error);
      return null;
    }
  }
}
