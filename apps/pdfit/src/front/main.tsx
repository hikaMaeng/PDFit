import ReactDOM from 'react-dom/client';
import { createPdfitServiceApp } from '@pdfit/pdfit/client/service';
import { settingsNavItem } from './nav/settingsNavItem';
import { settingsRoute } from './routes/settingsRoute';
import { translateDisplayTexts } from './api/settings';

const App = createPdfitServiceApp({
  appName: 'PDFit',
  appVersion: __APP_VERSION__,
  extraRoutes: [settingsRoute],
  extraSidebarItems: [settingsNavItem],
  displayTranslation: { translate: translateDisplayTexts },
  // Covers are rendered by the server's hourly thumbnail task, not in the browser.
  serverThumbnails: true,
});

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
