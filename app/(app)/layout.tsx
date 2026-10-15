import AppShell from '@/components/shell/AppShell';

// Every UI route lives in this group so they share one shell (Sidebar on md+, TabBar below)
// without the group name reaching the URL.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
