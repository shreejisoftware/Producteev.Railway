import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { cacheAside, cacheSet, cacheDel, CacheKeys } from '../utils/cache';
import { getIO } from '../socket';

interface UpdateUserInput {
  firstName?: string;
  lastName?: string;
  avatarUrl?: string | null;
  mobileNo?: string | null;
  technology?: string | null;
  settings?: any;
}

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
  mobileNo: true,
  technology: true,
  settings: true,
  createdAt: true,
} as const;

export class UserService {
  static async getAll() {
    return prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { firstName: 'asc' },
    });
  }

  static async getById(id: string) {
    return cacheAside(
      CacheKeys.user(id),
      async () => {
        const user = await prisma.user.findUnique({
          where: { id },
          select: USER_SELECT,
        });
        if (!user) throw ApiError.notFound('User not found');
        return user;
      },
      600 // 10 minutes
    );
  }

  static async update(id: string, data: UpdateUserInput) {
    const user = await prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });

    // Invalidate user cache after update
    await cacheDel(CacheKeys.user(id));
    // Re-populate cache with fresh data
    await cacheSet(CacheKeys.user(id), user, 600);

    // Invalidate org member caches for all orgs this user belongs to
    // This ensures that member lists across all their workspaces reflect the update
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: id },
      select: { organizationId: true }
    });

    const orgIds = memberships.map((m: { organizationId: string }) => m.organizationId);
    if (orgIds.length > 0) {
      const keysToDel = [
        ...orgIds.map((orgId: string) => CacheKeys.orgMembers(orgId)),
        ...orgIds.map((orgId: string) => CacheKeys.orgDetails(orgId))
      ];
      await cacheDel(...keysToDel);
    }
    
    // Emit socket events for real-time sync
    try {
      const io = getIO();
      // 1. Notify user's own tabs/devices
      io.to(`user:${id}`).emit('user:updated', user);

      // 2. Notify organizations the user belongs to
      if (orgIds.length > 0) {
        orgIds.forEach((orgId: string) => {
          io.to(`org:${orgId}`).emit('people:updated', { organizationId: orgId });
        });
      }
    } catch (e) {
      // Socket might not be initialized in some contexts
    }

    return user;
  }

  static async changePassword(id: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw ApiError.notFound('User not found');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw ApiError.badRequest('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id }, data: { passwordHash } });

    // Invalidate cache
    await cacheDel(CacheKeys.user(id));
  }

  static async deleteAccount(id: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw ApiError.notFound('User not found');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw ApiError.badRequest('Password is incorrect');

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: id },
      select: { organizationId: true },
    });
    const orgIds = memberships.map((m) => m.organizationId);

    await prisma.$transaction(async (tx) => {
      // Some relations to User are RESTRICT (no onDelete cascade),
      // so we transfer ownership/audit links to a placeholder account first.
      const placeholder = await tx.user.create({
        data: {
          email: `deleted+${id}.${Date.now()}@producteev.local`,
          passwordHash: `deleted:${crypto.randomUUID()}`,
          firstName: 'Deleted',
          lastName: 'User',
          avatarUrl: null,
          mobileNo: null,
          technology: null,
          settings: { sourceUserId: id, deletedAccountPlaceholder: true },
        },
        select: { id: true },
      });

      await tx.space.updateMany({ where: { createdById: id }, data: { createdById: placeholder.id } });
      await tx.project.updateMany({ where: { createdById: id }, data: { createdById: placeholder.id } });
      await tx.task.updateMany({ where: { createdById: id }, data: { createdById: placeholder.id } });
      await tx.attachment.updateMany({ where: { uploadedById: id }, data: { uploadedById: placeholder.id } });
      await tx.invitation.updateMany({ where: { invitedById: id }, data: { invitedById: placeholder.id } });

      // Optional audit references must be nulled out before deleting the user.
      await tx.space.updateMany({ where: { deletedById: id }, data: { deletedById: null } });
      await tx.folder.updateMany({ where: { deletedById: id }, data: { deletedById: null } });
      await tx.list.updateMany({ where: { deletedById: id }, data: { deletedById: null } });
      await tx.project.updateMany({ where: { deletedById: id }, data: { deletedById: null } });
      await tx.task.updateMany({ where: { deletedById: id }, data: { deletedById: null } });
      await tx.attachment.updateMany({ where: { deletedById: id }, data: { deletedById: null } });

      await tx.user.delete({ where: { id } });
    });

    // Invalidate all caches for this user
    await cacheDel(
      CacheKeys.user(id),
      CacheKeys.userNotifications(id),
      CacheKeys.dashboardStats(id)
    );

    if (orgIds.length > 0) {
      await cacheDel(
        ...orgIds.map((orgId) => CacheKeys.orgMembers(orgId)),
        ...orgIds.map((orgId) => CacheKeys.orgDetails(orgId))
      );
    }
  }
}
