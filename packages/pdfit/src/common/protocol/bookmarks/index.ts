export type BookmarkRect = { x: number; y: number; width: number; height: number };

/**
 * Text read from a clip. `text-layer` comes from the PDF itself; `vision` from the AI
 * server's vision model when the area has no text layer. `unavailable` means no AI
 * server could read an area without a text layer.
 */
export interface BookmarkOcr {
  status: 'pending' | 'done' | 'failed' | 'unavailable';
  text: string | null;
  source: 'text-layer' | 'vision' | null;
  error: string | null;
  updatedAt: string | null;
}

export interface BookmarkRecord {
  id: string;
  folder: string;
  filename: string;
  pageIndex: number;
  rect: BookmarkRect;
  borderColor: string;
  fillColor: string | null;
  fillOpacity: number;
  comment: string | null;
  imageMimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
  /** Absent where the runtime does not run OCR. */
  ocr?: BookmarkOcr | null;
}

export interface CreateBookmarkRequest {
  operationId?: string;
  pageIndex: number;
  rect: BookmarkRect;
  borderColor: string;
  fillColor?: string | null;
  fillOpacity?: number;
  comment?: string | null;
  imageMimeType: 'image/png' | 'image/webp';
  imageBase64: string;
}

export interface UpdateBookmarkRequest {
  borderColor?: string;
  fillColor?: string | null;
  fillOpacity?: number;
  comment?: string | null;
}
