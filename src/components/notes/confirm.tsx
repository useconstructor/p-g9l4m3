'use client';
import { useRef, type ReactNode, type RefObject } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
export function Confirm({ open, onCancel, onConfirm, title, children, action = 'Continuar', pending = false, danger = false, returnFocus, onClosed }: { open: boolean; onCancel: () => void; onConfirm: () => void; title: string; children: ReactNode; action?: string; pending?: boolean; danger?: boolean; returnFocus?: RefObject<HTMLElement | null>; onClosed?: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  return <AlertDialog open={open} onOpenChangeComplete={value => { if (!value) onClosed?.(); }} onOpenChange={value => { if (!value && !pending) onCancel(); }}>
    <AlertDialogContent className="confirm-dialog" initialFocus={cancel} finalFocus={returnFocus} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => !el.hidden);
      const first = items[0], last = items[items.length-1];
      if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }}>
      <AlertDialogTitle className="confirm-title">{title}</AlertDialogTitle>
      <AlertDialogDescription render={<div />} className="confirm-description">{children}</AlertDialogDescription>
      <div className="confirm-actions"><Button ref={cancel} className="control secondary" disabled={pending} onClick={onCancel}>Cancelar</Button><Button className={`control ${danger ? 'danger' : 'primary'}`} disabled={pending} onClick={onConfirm}>{pending ? 'Enviando…' : action}</Button></div>
    </AlertDialogContent>
  </AlertDialog>;
}
