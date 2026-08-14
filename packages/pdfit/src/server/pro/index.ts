import type { Router } from 'express';

export interface PdfitProRouterMount {
  path: string;
  router: Router;
}

export function createPdfitProRouterMount(path: string, router: Router): PdfitProRouterMount {
  return { path, router };
}
