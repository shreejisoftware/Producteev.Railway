import { prisma } from '../config/database';

export class ChecklistService {
  static async create(taskId: string, name: string) {
    return (prisma as any).checklist.create({
      data: {
        name,
        taskId,
      },
      include: {
        items: true,
      },
    });
  }

  static async update(id: string, name: string) {
    return (prisma as any).checklist.update({
      where: { id },
      data: { name },
    });
  }

  static async delete(id: string) {
    return (prisma as any).checklist.delete({
      where: { id },
    });
  }

  static async addItem(checklistId: string, text: string) {
    return (prisma as any).checklistItem.create({
      data: {
        text,
        checklistId,
      },
    });
  }

  static async updateItem(id: string, updates: { text?: string; checked?: boolean }) {
    return (prisma as any).checklistItem.update({
      where: { id },
      data: updates,
    });
  }

  static async deleteItem(id: string) {
    return (prisma as any).checklistItem.delete({
      where: { id },
    });
  }
}
