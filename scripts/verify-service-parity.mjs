import { existsSync, readFileSync } from 'node:fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const rootPackage = readJson('package.json');
const dockerApp = readJson('apps/pdfit/package.json');
const serviceApp = readJson('apps/service/package.json');
const serviceDomain = readJson('packages/service_domain/package.json');
const serviceRuntime = readJson('apps/service/docker/package.json');
const serviceMain = readFileSync('apps/service/src/front/auth/AuthGate.tsx', 'utf8');
const serviceViewer = readFileSync('apps/service/src/front/viewer-main.tsx', 'utf8');

assert(rootPackage.version === dockerApp.version, 'root and Docker PDFit versions differ');
assert(serviceApp.version === dockerApp.version, 'service app must follow the Docker PDFit version');
assert(serviceDomain.version === dockerApp.version, 'service domain must follow the Docker PDFit version');
assert(serviceRuntime.version === dockerApp.version, 'service runtime must follow the Docker PDFit version');
assert(serviceApp.dependencies['@pdfit/pdfit'] === dockerApp.version, 'service must pin the Docker PDFit client version');
assert(serviceApp.dependencies['@pdfit/service_domain'] === serviceDomain.version, 'service domain dependency must match its workspace version');
assert(serviceMain.includes('createPdfitServiceApp'), 'service must reuse the Docker PDFit service client');
assert(serviceMain.includes('v{__APP_VERSION__}'), 'service login must expose the Docker PDFit version');
assert(serviceViewer.includes("appName: 'PDFit Viewer'"), 'service viewer branding must match Docker PDFit');
assert(existsSync('docker-compose.yml') && !existsSync('apps/service/docker/docker-compose.yml'), 'root Compose must be the only deployment entry point');

console.log(`service parity passed: PDFit ${dockerApp.version}`);
