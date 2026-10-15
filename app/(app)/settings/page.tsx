import Link from 'next/link';
import { ChevronRight, CreditCard, Link2, Tags } from 'lucide-react';
import { ICON_STROKE } from '@/components/shell/nav';

const SECTIONS = [
  { href: '/settings/categories', label: 'Categorias', description: 'Categorias de gasto, subtipos e tipos de receita', icon: Tags },
  { href: '/settings/cards', label: 'Cartões e fechamento', description: 'Dias de corte e vencimento de cada cartão', icon: CreditCard },
  { href: '/settings/connections', label: 'Conexões bancárias', description: 'Contas conectadas pelo Pluggy', icon: Link2 },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4">
      <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">Ajustes</h1>
      <ul className="overflow-hidden rounded-card border border-border bg-surface-1">
        {SECTIONS.map(({ href, label, description, icon: Icon }, i) => (
          <li key={href} className={i > 0 ? 'border-t border-border' : undefined}>
            <Link
              href={href}
              className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-muted">
                <Icon size={20} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{label}</span>
                <span className="text-xs text-ink-muted">{description}</span>
              </span>
              <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" className="text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
