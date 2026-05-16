import { OrgRole } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
      };
      orgMember?: {
        id: string;
        organizationId: string;
        userId: string;
        role: OrgRole;
      };
    }
  }
}

export {};
