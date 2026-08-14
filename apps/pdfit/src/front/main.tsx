import ReactDOM from 'react-dom/client';
import { createPdfitServiceApp } from '@pdfit/pdfit/client/service';
import { settingsNavItem } from './nav/settingsNavItem';
import { settingsRoute } from './routes/settingsRoute';

const App = createPdfitServiceApp({
  appName: 'PDFit',
  appVersion: __APP_VERSION__,
  extraRoutes: [settingsRoute],
  extraSidebarItems: [settingsNavItem],
});

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
