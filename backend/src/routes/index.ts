import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import organizationRoutes from './organization.routes';
import spaceRoutes from './space.routes';
import projectRoutes from './project.routes';
import taskRoutes from './task.routes';
import dashboardRoutes from './dashboard.routes';
import searchRoutes from './search.routes';
import messageRoutes from './message.routes';
import attachmentRoutes from './attachment.routes';
import uploadRoutes from './upload.routes';
import timeEntryRoutes from './timeEntry.routes';
import activityRoutes from './activity.routes';
import commentRoutes from './comment.routes';
import statusRoutes from './status.routes';
import folderRoutes from './folder.routes';
import listRoutes from './list.routes';
import notificationRoutes from './notification.routes';
import invitationRoutes from './invitation.routes';
import tagRoutes from './tag.routes';
import adminRoutes from './admin.routes';
import slackRoutes from './slack.routes';
import checklistRoutes from './checklist.routes';
import { assetRouter } from './asset.routes';

export const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/organizations', organizationRoutes);
router.use('/spaces', spaceRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/folders', folderRoutes);
router.use('/lists', listRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/search', searchRoutes);
router.use('/messages', messageRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/uploads', uploadRoutes);
router.use('/uploads', assetRouter);
router.use('/time-entries', timeEntryRoutes);
router.use('/comments', commentRoutes);
// Slack OAuth callback must be reachable without auth header.
// NOTE: `statusRoutes`/`activityRoutes` currently apply `authenticate` at router level,
// so mount Slack BEFORE those catch-all mounts.
router.use('/slack', slackRoutes);
router.use('/', statusRoutes);
router.use('/', activityRoutes);
router.use('/notifications', notificationRoutes);
router.use('/invitations', invitationRoutes);
router.use('/tags', tagRoutes);
router.use('/admin', adminRoutes);
router.use('/checklists', checklistRoutes);
