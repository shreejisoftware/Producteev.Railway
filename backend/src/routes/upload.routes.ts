import { Router } from 'express';
import { UploadService } from '../services/upload.service';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';
import { UploadFolder } from '@prisma/client';

const router = Router();

// Get uploads by folder
router.get('/folder/:folder', authenticate, asyncHandler(async (req, res) => {
  const folderName = req.params.folder.toUpperCase();
  
  // Validate folder exists in enum
  const validFolders = ['AVATARS', 'CHAT', 'THUMBNAILS', 'SOUNDS'];
  if (!validFolders.includes(folderName)) {
    throw ApiError.badRequest('Invalid folder. Valid: AVATARS, CHAT, THUMBNAILS, SOUNDS');
  }

  const uploads = await UploadService.getByFolder(folderName as UploadFolder, 100);
  res.json({ success: true, data: uploads });
}));

// Get user's uploads
router.get('/user/me', authenticate, asyncHandler(async (req, res) => {
  const uploads = await UploadService.getByUser(req.user!.id, 50);
  res.json({ success: true, data: uploads });
}));

// Get upload by ID
router.get('/:id', authenticate, asyncHandler(async (req, res) => {
  const upload = await UploadService.getById(req.params.id);
  if (!upload) throw ApiError.notFound('Upload not found');
  res.json({ success: true, data: upload });
}));

// Delete upload
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const upload = await UploadService.getById(req.params.id);
  if (!upload) throw ApiError.notFound('Upload not found');
  
  // Only owner or admin can delete
  if (upload.uploadedById !== req.user!.id) {
    throw ApiError.forbidden('Cannot delete upload from another user');
  }

  await UploadService.delete(req.params.id);
  res.json({ success: true, message: 'Upload deleted' });
}));

export default router;
