import { ArrowDownLeft, CreditCard, Inbox, LayoutDashboard, ListOrdered, Plus, ScanQrCode, Settings, type LucideIcon } from 'lucide-react';

export type NavId = 'home' | 'transactions' | 'review' | 'settings';

export type NavItem = { id: NavId; label: string; href: string; icon: LucideIcon };

// Single source of truth for the shell: TabBar (phones) and Sidebar (md and up) render the
// same items in the same order, so both layouts teach one map.
export const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Início', href: '/', icon: LayoutDashboard },
  { id: 'transactions', label: 'Lançamentos', href: '/transactions', icon: ListOrdered },
  { id: 'review', label: 'Revisar', href: '/review', icon: Inbox },
  { id: 'settings', label: 'Ajustes', href: '/settings', icon: Settings },
];

export type AddAction = { label: string; description: string; href: string; icon: LucideIcon };

// The + menu: every way a record is created by hand. Bank import is not here — it arrives on
// its own and is reviewed under Revisar.
export const ADD_ACTIONS: AddAction[] = [
  { label: 'Novo gasto', description: 'Lançar manualmente', href: '/new/expense', icon: Plus },
  { label: 'Nova receita', description: 'Salário, reembolso…', href: '/new/income', icon: ArrowDownLeft },
  { label: 'Escanear nota fiscal', description: 'QR code ou PDF da NFC-e', href: '/import/receipt', icon: ScanQrCode },
  { label: 'Importar fatura', description: 'PDF da fatura do cartão', href: '/import/bill', icon: CreditCard },
];

export function activeNavId(pathname: string): NavId | null {
  if (pathname === '/') return 'home';
  for (const item of NAV_ITEMS) {
    if (item.href !== '/' && (pathname === item.href || pathname.startsWith(`${item.href}/`))) return item.id;
  }
  return null;
}

export function formatBadge(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/** Lucide at the design system's stroke weight. */
export const ICON_STROKE = 1.75;
