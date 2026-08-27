'use client';

import { type ReactNode, useEffect, useId, useRef } from 'react';

export function UnsavedChangesDialog({
  children,
  disabled,
  onStay,
  title,
}: {
  children: ReactNode;
  disabled: boolean;
  onStay: () => void;
  title: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      aria-modal="true"
      className="unsaved-changes-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!disabled) onStay();
      }}
      ref={dialogRef}
      role="alertdialog"
    >
      <h2 id={titleId}>{title}</h2>
      <div className="unsaved-changes-actions">{children}</div>
    </dialog>
  );
}
