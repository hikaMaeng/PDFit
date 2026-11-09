import ReactDOM from 'react-dom/client';
import { createPdfitViewerApp } from '@pdfit/pdfit/client/viewer';
import { translateDisplayTexts } from './api/settings';

const App = createPdfitViewerApp({
  appName: 'PDFit Viewer',
  appVersion: __APP_VERSION__,
  displayTranslation: { translate: translateDisplayTexts },
});

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
