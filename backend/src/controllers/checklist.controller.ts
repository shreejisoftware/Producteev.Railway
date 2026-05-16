import { Request, Response } from 'express';
import { ChecklistService } from '../services/checklist.service';
import { z } from 'zod';

const createChecklistSchema = z.object({
  name: z.string().min(1),
});

const updateChecklistSchema = z.object({
  name: z.string().min(1),
});

const addItemSchema = z.object({
  text: z.string().min(1),
});

const updateItemSchema = z.object({
  text: z.string().min(1).optional(),
  checked: z.boolean().optional(),
});

export class ChecklistController {
  static async create(req: Request, res: Response) {
    const taskId = req.params.taskId as string;
    const { name } = createChecklistSchema.parse(req.body);
    const checklist = await ChecklistService.create(taskId, name);
    res.json({ success: true, data: checklist });
  }

  static async update(req: Request, res: Response) {
    const id = req.params.id as string;
    const { name } = updateChecklistSchema.parse(req.body);
    const checklist = await ChecklistService.update(id, name);
    res.json({ success: true, data: checklist });
  }

  static async delete(req: Request, res: Response) {
    const id = req.params.id as string;
    await ChecklistService.delete(id);
    res.json({ success: true });
  }

  static async addItem(req: Request, res: Response) {
    const checklistId = req.params.id as string;
    const { text } = addItemSchema.parse(req.body);
    const item = await ChecklistService.addItem(checklistId, text);
    res.json({ success: true, data: item });
  }

  static async updateItem(req: Request, res: Response) {
    const itemId = req.params.itemId as string;
    const updates = updateItemSchema.parse(req.body);
    const item = await ChecklistService.updateItem(itemId, updates);
    res.json({ success: true, data: item });
  }

  static async deleteItem(req: Request, res: Response) {
    const itemId = req.params.itemId as string;
    await ChecklistService.deleteItem(itemId);
    res.json({ success: true });
  }
}
