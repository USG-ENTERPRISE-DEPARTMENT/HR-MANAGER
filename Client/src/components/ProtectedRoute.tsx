import React from 'react';
import { AppUser } from '../../types/permissions';
import { canAccessNav } from '../../lib/permissions';
import AccessDenied from './AccessDenied';

interface ProtectedRouteProps {
  user: AppUser;
  /**
   * The nav key to check against NAV_PERMISSIONS.
   * e.g. "students", "fees-structure", "settings-super-admin"
   * Leave empty to allow all authenticated users through.
   */
  navKey?: string;
  children: React.ReactNode;
}

/**
 * ProtectedRoute
 * 
 * Wraps a route and shows <AccessDenied /> if the user lacks the required permission.
 * Works with both role-based and direct permissions — the AppUser already has
 * resolved permissions baked in via normalizeUser().
 * 
 * Usage in App.tsx:
 *   <Route path="/students" element={
 *     <ProtectedRoute user={currentUser} navKey="students">
 *       <StudentManagement />
 *     </ProtectedRoute>
 *   } />
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ user, navKey, children }) => {
  if (navKey && !canAccessNav(user, navKey)) {
    return <AccessDenied />;
  }
  return <>{children}</>;
};

export default ProtectedRoute;