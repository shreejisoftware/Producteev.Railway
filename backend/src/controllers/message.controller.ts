import { Request, Response } from 'express';
import { z } from 'zod';
import { MessageService } from '../services/message.service';
import { asyncHandler } from '../utils/asyncHandler';
import { ApiError } from '../utils/ApiError';

const sendSchema = z.object({
  receiverId: z.string().uuid(),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileType: z.string().optional(),
  fileSize: z.number().optional(),
});

export class MessageController {
  getConversation = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const userId = String(req.params.userId);
    const before = req.query.before ? String(req.query.before) : undefined;
    const messages = await MessageService.getConversation(req.user.id, userId, 50, before);
    res.json({ success: true, data: messages });
  });

  sendMessage = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    console.log(`Incoming message from ${req.user.id} to ${req.body.receiverId}: ${req.body.text}`);
    const { receiverId, text, imageUrl, fileUrl, fileName, fileType, fileSize } = sendSchema.parse(req.body);
    if (!text && !imageUrl && !fileUrl) throw ApiError.badRequest('Message must have text or file');

    const message = await MessageService.sendMessage(
      req.user.id, 
      receiverId, 
      text, 
      imageUrl,
      fileUrl,
      fileName,
      fileType,
      fileSize
    );

    // Real-time message emission is handled in MessageService.sendMessage

    res.json({ success: true, data: message });
  });

  getRecentChats = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const chats = await MessageService.getRecentChats(req.user.id);
    res.json({ success: true, data: chats });
  });

  getUnreadCounts = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const counts = await MessageService.getUnreadCounts(req.user.id);
    res.json({ success: true, data: counts });
  });

  markAsRead = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const senderId = String(req.params.senderId);
    await MessageService.markAsRead(req.user.id, senderId);

    // Read receipt emission is handled in MessageService.markAsRead
    res.json({ success: true });
  });

  clearConversation = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const otherUserId = String(req.params.userId);
    const count = await MessageService.clearConversation(req.user.id, otherUserId);
    res.json({ success: true, deleted: count });
  });

  deleteMessages = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const { messageIds } = z.object({ messageIds: z.array(z.string().uuid()).min(1) }).parse(req.body);
    const count = await MessageService.deleteMessages(req.user.id, messageIds);
    res.json({ success: true, deleted: count });
  });
}
