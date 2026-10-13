'use client';

import Link from 'next/link';
import Sheet from './Sheet';
import { ADD_ACTIONS, ICON_STROKE } from './nav';

export default function AddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title="Adicionar" onClose={onClose}>
      <ul className="-mx-2 flex flex-col">
        {ADD_ACTIONS.map(({ label, description, href, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              onClick={onClose}
              className="flex min-h-14 items-center gap-3 rounded-control p-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
                <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-ink-muted">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
