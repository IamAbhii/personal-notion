import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router';
import { watchForUnload } from './sync/ops';
import './styles/theme.css';
import './styles/app.css';
// Temporary: legacy component rules kept here while Part 2 migrates each component to co-located
// CSS Modules. This import is removed when legacy.css is empty.
import './styles/legacy.css';

// Entry point. One QueryClient for the app, handed to the router as context so route loaders and
// components share the same cache.
// Future: wrap this client in the IndexedDB persister from the offline layer so a cold start with no
// network still renders the last known workspace.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

// Before anything mounts, so this listener runs ahead of every editor's own unload flush and the
// write path knows the page is leaving by the time a flush asks it for a transport.
watchForUnload();

const router = createAppRouter(queryClient);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
