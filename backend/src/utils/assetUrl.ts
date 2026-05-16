import { Request } from 'express';

/**
 * Convert relative asset paths to full URLs
 * Handles avatars, thumbnails, and other uploaded files
 * 
 * @param relativePath - Path like /uploads/avatars/filename or null
 * @param req - Express request object (used to get protocol and host)
 * @returns Full URL or the original value if already absolute or null
 */
export function buildFullAssetUrl(relativePath: string | null | undefined, req: Request): string | null | undefined {
  if (!relativePath) return relativePath;
  if (relativePath.startsWith('http')) return relativePath; // Already absolute
  const origin = `${req.protocol}://${req.get('host')}`;
  return `${origin}${relativePath}`;
}

/**
 * Transform user object to include full asset URLs
 */
export function transformUser(user: any, req: Request): any {
  if (!user) return user;
  return {
    ...user,
    avatarUrl: buildFullAssetUrl(user.avatarUrl, req),
  };
}

/**
 * Transform array of users
 */
export function transformUsers(users: any[], req: Request): any[] {
  return users.map(user => transformUser(user, req));
}

/**
 * Transform objects containing user references (like members, assignees, etc.)
 */
export function transformUserInContext(obj: any, req: Request, userPaths: string[] = ['user', 'assignees', 'createdBy']): any {
  if (!obj) return obj;
  
  const result = { ...obj };
  
  for (const path of userPaths) {
    const parts = path.split('.');
    let current = result;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]]) return result;
      current = current[parts[i]];
    }
    
    const lastPart = parts[parts.length - 1];
    if (Array.isArray(current[lastPart])) {
      current[lastPart] = current[lastPart].map((u: any) => transformUser(u, req));
    } else if (current[lastPart]) {
      current[lastPart] = transformUser(current[lastPart], req);
    }
  }
  
  return result;
}
