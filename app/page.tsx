'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AddExpense from './AddExpense';
import AddIncome from './AddIncome';
import DashBoard from './Dashboard';
import DashboardDetails from './DashboardDetails';
import CardConfigPage from './CardConfig';
import ImportReceipt from './ImportReceipt';
import ImportBill from './ImportBill';
import CategoryConfig from './CategoryConfig';
import NavMenu, { viewTitle, type ViewId } from '@/components/NavMenu';

export default function MainPage() {
  const [currentView, setCurrentView] = useState<ViewId>('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeNavRef = useRef<HTMLButtonElement>(null);
  const openNavRef = useRef<HTMLButtonElement>(null);

  // Carries the dashboard's selected month / view mode into the details view
  const [detailsMonth, setDetailsMonth] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [detailsViewMode, setDetailsViewMode] = useState<'purchase' | 'payment'>('purchase');

  // Every view switch goes through here so the mobile drawer can never stay
  // open over the new screen — including the switches driven by callbacks
  // (import finished, back from details).
  const selectView = useCallback((view: ViewId) => {
    setCurrentView(view);
    setNavOpen(false);
  }, []);

  const handleOpenDetails = useCallback((month: string, viewMode: 'purchase' | 'payment') => {
    setDetailsMonth(month);
    setDetailsViewMode(viewMode);
    selectView('dashboardDetails');
  }, [selectView]);

  const handleExpenseAdded = useCallback(() => {
    selectView('dashboard');
  }, [selectView]);

  const handleIncomeAdded = useCallback(() => {
    selectView('dashboard');
  }, [selectView]);

  const handleImported = useCallback(() => {
    selectView('dashboard');
  }, [selectView]);

  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false);
        return;
      }
      // role="dialog" + aria-modal promises focus containment, so deliver it:
      // Tab must cycle inside the drawer instead of reaching the content the
      // overlay hides.
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusables = drawerRef.current.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !drawerRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !drawerRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    // The drawer covers a document that scrolls, so without this a drag on the
    // scrim scrolls the page underneath and leaves it at an unrelated offset
    // once the drawer closes.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // aria-modal claims focus containment; at minimum move focus into the
    // drawer so Tab does not walk straight into the content behind it.
    closeNavRef.current?.focus();
    const opener = openNavRef.current;
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [navOpen]);

  return (
    <div className="flex min-h-dvh bg-gray-50">
      {/* Sidebar (md and up) */}
      <div className="hidden md:block w-56 shrink-0 bg-gray-200 p-4 border-r border-gray-300 md:sticky md:top-0 md:h-dvh md:overflow-y-auto">
        <h2 className="text-lg font-bold mb-6 text-gray-800">Financeiro</h2>
        <NavMenu currentView={currentView} onSelect={selectView} />
      </div>

      {/* Drawer (below md) */}
      {navOpen && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setNavOpen(false)}
          />
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 w-64 max-w-[85vw] bg-gray-200 p-4 shadow-xl overflow-y-auto pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-800">Financeiro</h2>
              <button
                ref={closeNavRef}
                onClick={() => setNavOpen(false)}
                aria-label="Fechar menu"
                className="text-gray-500 hover:text-gray-800 text-2xl leading-none px-3 py-1"
              >
                &times;
              </button>
            </div>
            <NavMenu currentView={currentView} onSelect={selectView} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top bar (below md) */}
        <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-gray-200 border-b border-gray-300 px-3 py-2">
          <button
            ref={openNavRef}
            onClick={() => setNavOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={navOpen}
            className="p-2.5 -ml-1 rounded text-gray-700 hover:bg-gray-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-gray-800 truncate">{viewTitle(currentView)}</span>
        </header>

        {/* Main Content */}
        {/* The safe-area bottom padding has to be restated per breakpoint: an
            unconditional arbitrary pb-* would override sm:p-6's bottom edge. */}
        <div className="flex-1 min-w-0 p-3 sm:p-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {currentView === 'dashboard' && <DashBoard onOpenDetails={handleOpenDetails} />}

          {currentView === 'dashboardDetails' && (
            <DashboardDetails
              initialMonth={detailsMonth}
              initialViewMode={detailsViewMode}
              onBack={() => selectView('dashboard')}
            />
          )}

          {currentView === 'addExpense' && (
            <AddExpense onExpenseAdded={handleExpenseAdded} />
          )}

          {currentView === 'addIncome' && (
            <AddIncome onIncomeAdded={handleIncomeAdded} />
          )}

          {currentView === 'cardConfig' && (
            <CardConfigPage />
          )}

          {currentView === 'categoryConfig' && (
            <CategoryConfig />
          )}

          {currentView === 'importReceipt' && (
            <ImportReceipt onImported={handleImported} />
          )}

          {currentView === 'importBill' && (
            <ImportBill onDone={() => selectView('dashboard')} />
          )}
        </div>
      </div>
    </div>
  );
}
