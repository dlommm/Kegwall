import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAdminPortal } from './portal';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** One line under the title; read out when the dialog opens. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the foot, the main action first. */
  footer?: ReactNode;
  /** `alertdialog` for a confirm that destroys something. */
  role?: 'dialog' | 'alertdialog';
  testId?: string;
}

/**
 * A small centred dialog for a decision that has to be made before going on (delete, log a
 * cleaning on a date). Everything longer belongs in a Drawer.
 */
export function Modal({
  open, onOpenChange, title, description, children, footer, role = 'dialog', testId,
}: ModalProps) {
  const container = useAdminPortal();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="adm-overlay" />
        <Dialog.Content className="adm-modal" role={role} data-testid={testId}>
          <Dialog.Title className="adm-modal__title">{title}</Dialog.Title>
          {description
            ? <Dialog.Description className="adm-modal__desc">{description}</Dialog.Description>
            : <Dialog.Description className="adm-sr-only">{title}</Dialog.Description>}
          {children}
          {footer && <div className="adm-modal__foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** The whole consequence, as a sentence ("This permanently deletes tap 3."). */
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  /** `danger` when the action can't be undone. */
  tone?: 'danger' | 'primary';
  testId?: string;
  confirmTestId?: string;
  cancelTestId?: string;
  errorTestId?: string;
}

/** Confirm one action: a consequence sentence, the action, Cancel. Closing is blocked while busy. */
export function ConfirmDialog({
  open, onOpenChange, title, children, confirmLabel, busyLabel, busy = false, error, onConfirm,
  tone = 'danger', testId, confirmTestId, cancelTestId, errorTestId,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title={title}
      role={tone === 'danger' ? 'alertdialog' : 'dialog'}
      testId={testId}
      footer={(
        <>
          <Button variant={tone} data-testid={confirmTestId} disabled={busy} onClick={onConfirm}>
            {busy && busyLabel ? busyLabel : confirmLabel}
          </Button>
          <Button variant="quiet" data-testid={cancelTestId} disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </>
      )}
    >
      <div className="adm-modal__body">{children}</div>
      {error && <p className="adm-modal__error" role="alert" data-testid={errorTestId}>{error}</p>}
    </Modal>
  );
}
