import { Request, Response } from 'express';
import { z } from 'zod';
import { CommentService } from '../services/comment.service';
import { TaskService } from '../services/task.service';
import { ActivityService } from '../services/activity.service';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../config/database';
import { getIO } from '../socket';

const attachmentPartSchema = z.object({
  fileUrl: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
});

const createSchema = z.object({
  text: z.string().optional().default(''),
  imageUrl: z.string().optional().nullable(),
  fileUrl: z.string().optional().nullable(),
  fileName: z.string().optional().nullable(),
  fileType: z.string().optional().nullable(),
  fileSize: z.number().optional().nullable(),
  attachments: z.array(attachmentPartSchema).optional(),
  mentions: z.array(z.string()).optional(),
  exclusiveMention: z.boolean().optional(),
});

const removeAttachmentSchema = z.object({
  fileUrl: z.string().min(1),
});

function normalizeUrl(u: string) {
  try {
    const url = new URL(u, 'http://local');
    const pathname = url.pathname || '';
    // collapse duplicate slashes, strip trailing slash
    return pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  } catch {
    return String(u || '')
      .split('?')[0]
      .split('#')[0]
      .trim()
      .replace(/\/{2,}/g, '/')
      .replace(/\/$/, '');
  }
}

export class CommentController {
  /** POST /tasks/:taskId/comments */
  create = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const taskId = req.params.taskId as string;
    const { text, imageUrl, fileUrl, fileName, fileType, fileSize, attachments, mentions } = createSchema.parse(req.body);

    const task = await TaskService.getById(taskId, req.user.id);
    const organizationId = task.project?.organizationId || ((task as any).list?.space?.organizationId);

    if (!organizationId) throw ApiError.badRequest('Unable to resolve organization for task');

    const membership = await prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId: req.user.id
        }
      }
    });

    if (!membership) throw ApiError.forbidden('Not a member of this organization');
    if (membership.role === 'GUEST') throw ApiError.forbidden('Guests cannot add comments');

    const fileData = {
      imageUrl,
      fileUrl,
      fileName,
      fileType,
      fileSize,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    };
    const comment = await CommentService.create(taskId, req.user.id, text || '', membership.role, fileData, { mentions });

    await ActivityService.log({
      userId: req.user.id,
      entityType: 'task',
      entityId: taskId,
      action: 'comment.created',
      changes: { 
        commentId: comment.id, 
        text,
        fileUrl: comment.fileUrl,
        fileName: comment.fileName,
        fileType: comment.fileType,
        fileSize: comment.fileSize,
        attachmentCount: Array.isArray((comment as any).attachments) ? (comment as any).attachments.length : 0,
      },
      mentions: mentions || [],
      isPrivate: false
    });

    try {
      import('../socket').then(({ getIO }) => {
        getIO().emit('task:refresh');
        if (organizationId) {
          getIO().to(`org:${organizationId}`).emit('task:updated', { taskId });
        }
      });
    } catch (e) { }

    res.status(201).json({ success: true, data: comment });
  });

  /** GET /tasks/:taskId/comments */
  getByTask = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const taskId = req.params.taskId as string;
    const comments = await CommentService.getByTask(taskId);
    res.json({ success: true, data: comments });
  });

  /** DELETE /comments/:id */
  delete = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const commentId = req.params.id as string;

    // If the comment contains comment-only uploads, soft-delete them so they appear in Recovery Panel.
    let isAdmin = false;
    try {
      const c = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
          taskId: true,
          fileUrl: true,
          attachments: true,
        },
      });

      if (c) {
        const taskId = c.taskId;
        const task = await TaskService.getById(taskId, req.user.id);
        const organizationId = task.project?.organizationId || ((task as any).list?.space?.organizationId);
        if (organizationId) {
          const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId: req.user.id } },
          });
          if (membership) {
            isAdmin = ['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(membership.role);
          }
        }

        const urls: string[] = [];
        if ((c as any)?.fileUrl) urls.push(String((c as any).fileUrl));
        if (Array.isArray((c as any)?.attachments)) {
          for (const a of (c as any).attachments) {
            if (a?.fileUrl) urls.push(String(a.fileUrl));
          }
        }

        if (taskId && urls.length > 0) {
          const { AttachmentService } = await import('../services/attachment.service');
          for (const u of urls) {
            const pathname = normalizeUrl(u);
            const idx = pathname.lastIndexOf('/uploads/');
            const filename = idx !== -1 ? pathname.slice(idx + '/uploads/'.length) : (pathname.split('/').pop() || '');
            if (!filename) continue;

            const att = await prisma.attachment.findFirst({
              where: {
                taskId,
                filename,
                isDeleted: false,
                originalName: { startsWith: '__COMMENT__:' },
              },
              select: { id: true },
            });
            if (att?.id) {
              await AttachmentService.delete(att.id, req.user.id);
            }
          }
        }
      }
    } catch {
      // non-fatal
    }

    await CommentService.delete(commentId, req.user.id, isAdmin);
    await ActivityService.deleteByCommentId(commentId);
    
    res.json({ success: true, message: 'Comment deleted' });
  });

  /** PATCH /comments/:id/attachments { fileUrl } */
  removeAttachment = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const commentId = req.params.id as string;
    const { fileUrl } = removeAttachmentSchema.parse(req.body);

    // Resolve isAdmin
    let isAdmin = false;
    try {
      const c = await prisma.comment.findUnique({ where: { id: commentId }, select: { taskId: true } });
      if (c) {
        const task = await TaskService.getById(c.taskId, req.user.id);
        const organizationId = task.project?.organizationId || ((task as any).list?.space?.organizationId);
        if (organizationId) {
          const membership = await prisma.organizationMember.findUnique({
            where: { organizationId_userId: { organizationId, userId: req.user.id } },
          });
          if (membership) {
            isAdmin = ['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(membership.role);
          }
        }
      }
    } catch { /* ignore */ }

    const updated = await CommentService.removeAttachment(commentId, req.user.id, fileUrl, isAdmin);

    // Keep activity feed consistent with latest comment state (so deleted files disappear in InboxDetails).
    try {
      const acts = await prisma.activity.findMany({
        where: {
          action: 'comment.created',
          changes: { path: ['commentId'], equals: commentId },
        },
        select: { id: true, changes: true, entityId: true },
      });

      const nextAttachmentCount = Array.isArray((updated as any).attachments)
        ? (updated as any).attachments.length
        : 0;

      await Promise.all(
        acts.map(async (a) => {
          const changes: any = (a.changes as any) || {};
          const next = { ...changes, attachmentCount: nextAttachmentCount };

          if (next.fileUrl === fileUrl) {
            next.fileUrl = null;
            next.fileName = null;
            next.fileType = null;
            next.fileSize = null;
          }

          await prisma.activity.update({
            where: { id: a.id },
            data: { changes: next },
          });
        })
      );

      // Nudge clients to reload timeline.
      getIO().emit('task:refresh');
    } catch (e) {
      // non-fatal
    }

    // Also soft-delete the underlying attachment record when this was a comment-only upload,
    // so it becomes visible in the Recovery Panel.
    try {
      const c = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { taskId: true },
      });

      const taskId = c?.taskId;
      if (taskId) {
        const pathname = normalizeUrl(fileUrl);
        const idx = pathname.lastIndexOf('/uploads/');
        const filename = idx !== -1 ? pathname.slice(idx + '/uploads/'.length) : (pathname.split('/').pop() || '');

        if (filename) {
          const att = await prisma.attachment.findFirst({
            where: {
              taskId,
              filename,
              isDeleted: false,
              originalName: { startsWith: '__COMMENT__:' },
            },
            select: { id: true },
          });
          if (att?.id) {
            const { AttachmentService } = await import('../services/attachment.service');
            await AttachmentService.delete(att.id, req.user.id);
          }
        }
      }
    } catch (e) {
      // non-fatal
    }

    res.json({ success: true, data: updated });
  });
}
