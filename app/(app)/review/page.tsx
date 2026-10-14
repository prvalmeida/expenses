import PluggySync from '@/components/screens/PluggySync';

// Review stays on this screen after an import (the queue shrinks in place); the tab bar
// is the way out, so the screen no longer takes an onDone callback.
export default function Page() {
  return <PluggySync />;
}
