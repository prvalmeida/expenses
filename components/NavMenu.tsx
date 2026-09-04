'use client';

export type ViewId =
  | 'dashboard'
  | 'dashboardDetails'
  | 'addExpense'
  | 'addIncome'
  | 'cardConfig'
  | 'categoryConfig'
  | 'importReceipt'
  | 'importBill';

type NavItem = { id: Exclude<ViewId, 'dashboardDetails'>; label: string };

// Single source of truth for the nav: rendered by both the static sidebar and
// the mobile drawer, and used for the top bar title.
export const NAV_GROUPS: NavItem[][] = [
  [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'addExpense', label: '➕ Novo Gasto' },
    { id: 'addIncome', label: '➕ Nova Receita' },
  ],
  [
    { id: 'cardConfig', label: '💳 Fechamento Cartão' },
    { id: 'categoryConfig', label: '🏷️ Categorias' },
    { id: 'importReceipt', label: '📄 Importar NF' },
    { id: 'importBill', label: '💳 Importar Fatura' },
  ],
];

const VIEW_TITLES: Record<ViewId, string> = {
  dashboard: 'Dashboard',
  dashboardDetails: 'Detalhes',
  addExpense: 'Novo Gasto',
  addIncome: 'Nova Receita',
  cardConfig: 'Fechamento Cartão',
  categoryConfig: 'Categorias',
  importReceipt: 'Importar NF',
  importBill: 'Importar Fatura',
};

export function viewTitle(view: ViewId) {
  return VIEW_TITLES[view];
}

type Props = {
  currentView: ViewId;
  onSelect: (view: ViewId) => void;
};

export default function NavMenu({ currentView, onSelect }: Props) {
  return (
    <nav className="space-y-3">
      {NAV_GROUPS.map((group, index) => (
        <div key={index} className="space-y-3">
          {index > 0 && <hr className="border-gray-400 my-4" />}
          {group.map(item => {
            const active =
              currentView === item.id ||
              (item.id === 'dashboard' && currentView === 'dashboardDetails');
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className={`w-full text-left px-3 py-2.5 rounded transition-colors ${
                  active
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
