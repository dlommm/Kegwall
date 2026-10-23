import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAdminPortal } from './portal';

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** Buttons pinned to the drawer's foot (Save, Cancel). */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Details and editing for one row, in a right-hand sheet (a bottom sheet on phones). Radix
 * Dialog underneath: focus is trapped while open, Escape closes, and focus returns to the
 * row that opened it.
 */
export function Drawer({
  open, onOpenChange, title, description, footer, children,
}: DrawerProps) {
  const container = useAdminPortal();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="adm-overlay" />
        <Dialog.Content className="adm-drawer">
          <header className="adm-drawer__head">
            <Dialog.Title className="adm-drawer__title">{title}</Dialog.Title>
            <Dialog.Close className="adm-btn adm-btn--quiet adm-drawer__close">Close</Dialog.Close>
          </header>
          {description
            ? <Dialog.Description className="adm-drawer__desc">{description}</Dialog.Description>
            : <Dialog.Description className="adm-sr-only">{title}</Dialog.Description>}
          <div className="adm-drawer__body">{children}</div>
          {footer && <footer className="adm-drawer__foot">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
