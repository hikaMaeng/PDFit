import type { Request } from 'express';
import type { MetadataStore } from '../../shared/index.js';

/** Resolves shared metadata operations globally or from an authenticated request. */
export type MetadataStoreResolver = MetadataStore | ((request: Request) => MetadataStore | Promise<MetadataStore>);

/** Returns the metadata store that owns the current request. */
export async function resolveMetadataStore(resolver: MetadataStoreResolver, request: Request): Promise<MetadataStore> {
  return typeof resolver === 'function' ? resolver(request) : resolver;
}
