import { createContext, useContext } from 'react';

/**
 * Where Radix portals mount in the admin. The admin look's tokens are scoped to the shell's
 * ThemeProvider element, so menus, drawers and dialogs portal into a node inside it rather
 * than straight into `document.body` (where they'd lose every color). Undefined outside the
 * shell, which falls back to Radix's default (body).
 */
export const AdminPortalContext = createContext<HTMLElement | null>(null);

export function useAdminPortal(): HTMLElement | undefined {
  return useContext(AdminPortalContext) ?? undefined;
}
