export type BookmarkRect = { x: number; y: number; width: number; height: number };

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
