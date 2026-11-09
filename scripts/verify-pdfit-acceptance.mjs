import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const baseUrl = getArgValue('--base-url') ?? process.env.PDFIT_ACCEPTANCE_BASE_URL ?? 'http://127.0.0.1:15201';
const reportPath = getArgValue('--report') ?? process.env.PDFIT_ACCEPTANCE_REPORT_PATH ?? defaultReportPath();
const caseFilter = getArgValue('--case');
const groupFilter = getArgValue('--group');

const { CASES } = await import(pathToFileURL(path.join(root, 'apps/pdfit/tests/acceptance/cases.mjs')).href);
const runtime = await import(pathToFileURL(path.join(root, 'apps/pdfit/tests/acceptance/lib/runtime.mjs')).href);

const selectedCases = CASES.filter((testCase) => {
  if (caseFilter && testCase.id !== caseFilter) return false;
  if (groupFilter && testCase.group !== groupFilter) return false;
  return true;
});

if (selectedCases.length === 0) {
  throw new Error('No acceptance cases matched the provided filters.');
}

await runtime.ensureDir(path.dirname(reportPath));

const report = {
  startedAt: new Date(),
  finishedAt: null,
  baseUrl,
  deploy: await runtime.collectDeployEvidence(root),
  docker: null,
  cases: [],
};

await runtime.resetPdfitService(root, baseUrl);
for (const testCase of selectedCases) {
  await runtime.cleanupSeed(baseUrl, testCase.seed ?? {});
}
report.docker = await runtime.collectDockerEvidence(root);

const browser = await chromium.launch({ headless: true });

try {
  for (const testCase of selectedCases) {
    const caseContext = await runtime.createCaseContext({
      browser,
      baseUrl,
      root,
      testCase,
      reportPath,
    });

    const caseResult = {
      id: testCase.id,
      group: testCase.group,
      title: testCase.title,
      status: 'passed',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null,
      screenshot: null,
      notes: [],
    };

    try {
      await runtime.resetPdfitService(root, baseUrl);
      await runtime.assertEmptyState(baseUrl);
      await runtime.seedCase(caseContext, testCase.seed ?? {});
      await runtime.runCase(caseContext, testCase);
      caseResult.notes.push(...caseContext.notes);
    } catch (error) {
      caseResult.status = 'failed';
      caseResult.error = runtime.describeError(error);
      caseResult.screenshot = await runtime.captureFailureArtifact(caseContext, testCase.id);
      caseResult.notes.push(...caseContext.notes);
    } finally {
      caseResult.finishedAt = new Date().toISOString();
      report.cases.push(caseResult);
      await caseContext.close();
      await runtime.cleanupSeed(baseUrl, testCase.seed ?? {});
    }
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date();
report.summary = runtime.summarizeCases(report.cases);

await writeFile(reportPath, runtime.renderReport(report), 'utf8');

if (report.summary.failed > 0) {
  console.error(runtime.renderFailureSummary(report));
  process.exitCode = 1;
} else {
  console.log(`acceptance passed: ${report.summary.passed}/${report.summary.total}`);
  console.log(`report: ${reportPath}`);
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function defaultReportPath() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '_');
  return path.join(root, 'apps/pdfit/tests/reports/acceptance-matrix', `${stamp}.md`);
}
