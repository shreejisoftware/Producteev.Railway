import { prisma } from '../config/database';
import { Upload, UploadFolder } from '@prisma/client';

export class UploadService {
  static async create(input: {
    filename: string;
    originalName: string;
    mimeType: string;
    size: number;
    folder: UploadFolder;
    uploadedById: string;
  }): Promise<Upload> {
    return prisma.upload.create({ data: input });
  }

  static async getByFolder(folder: UploadFolder, limit = 50) {
    return prisma.upload.findMany({
      where: { folder },
      include: { 
        uploadedBy: { 
          select: { id: true, email: true, firstName: true, lastName: true } 
        } 
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  static async getById(id: string) {
    return prisma.upload.findUnique({
      where: { id },
      include: {
        uploadedBy: {
          select: { id: true, email: true, firstName: true, lastName: true }
        }
      }
    });
  }

  static async delete(id: string) {
    return prisma.upload.delete({ where: { id } });
  }

  static async getByUser(userId: string, limit = 50) {
    return prisma.upload.findMany({
      where: { uploadedById: userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
