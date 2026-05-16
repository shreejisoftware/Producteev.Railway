import { useMemo } from 'react';
import { useAppSelector } from '../store';

export function useOrgRole() {
  const { orgRole } = useAppSelector((state) => state.organization);

  return useMemo(() => ({
    orgRole,
    isOwner: orgRole === 'OWNER',
    isSuperAdmin: orgRole === 'SUPER_ADMIN',
    isAdmin: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    isMember: orgRole === 'MEMBER',
    isLimitedMember: orgRole === 'LIMITED_MEMBER',
    isGuest: orgRole === 'GUEST',
    // Helpers
    canManageOrg: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canManagePeople: orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN', // Restored for Super Admin
    canCreateSpace: orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canSeeFullSidebar: !!orgRole,
    canCreateProject: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canDeleteProject: orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN', // Restrict deletion
    canEditProjectDescription: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canCreateTask: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canDeleteTask: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canUpdateTaskStatus: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN' || orgRole === 'MEMBER' || orgRole === 'LIMITED_MEMBER',
    canUpdateTaskPriority: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN' || orgRole === 'MEMBER' || orgRole === 'LIMITED_MEMBER',
    canUpdateTaskDetails: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN',
    canAssignTask: orgRole === 'ADMIN' || orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN' || orgRole === 'MEMBER',
    canAddComments: orgRole !== 'GUEST',
    isReadOnly: orgRole === 'GUEST',
    // Screen Sharing Permissions
    canRequestScreen: orgRole === 'OWNER' || orgRole === 'SUPER_ADMIN' || orgRole === 'ADMIN',
  }), [orgRole]);
}
