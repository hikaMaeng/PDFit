import ReactDOM from 'react-dom/client';
import { createPdfitViewerApp } from '@pdfit/pdfit/client/viewer';

const App = createPdfitViewerApp({
  appName: 'PDFit Viewer',
  appVersion: __APP_VERSION__,
});

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
