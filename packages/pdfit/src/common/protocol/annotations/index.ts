export type AnnotationType = 'highlight' | 'text' | 'ink' | 'rectangle' | 'circle' | 'line' | 'arrow';

export type AnnotationPoint = {
  x: number;
  y: number;
};

export type AnnotationRect = AnnotationPoint & {
  width: number;
  height: number;
};

export type AnnotationStyle = {
  color: string;
  opacity: number;
  strokeWidth: number;
  fillColor: string | null;
};

type AnnotationBase<TType extends AnnotationType, TGeometry> = {
  id: string;
  documentId: string;
  pageIndex: number;
  type: TType;
  geometry: TGeometry;
  style: AnnotationStyle;
  createdAt: string;
  updatedAt: string;
};

export type RectangleAnnotation = AnnotationBase<'rectangle', AnnotationRect>;
export type CircleAnnotation = AnnotationBase<'circle', AnnotationRect>;
export type HighlightAnnotation = AnnotationBase<'highlight', AnnotationRect>;
export type LineAnnotation = AnnotationBase<'line', { start: AnnotationPoint; end: AnnotationPoint }>;
export type ArrowAnnotation = AnnotationBase<'arrow', { start: AnnotationPoint; end: AnnotationPoint }>;
export type InkAnnotation = AnnotationBase<'ink', { points: AnnotationPoint[] }>;
export type TextAnnotation = AnnotationBase<'text', AnnotationRect & { text: string; fontSize: number }>;

/** Persisted, page-coordinate annotation record shared by the browser and server. */
export type Annotation =
  | RectangleAnnotation
  | CircleAnnotation
  | HighlightAnnotation
  | LineAnnotation
  | ArrowAnnotation
  | InkAnnotation
  | TextAnnotation;

export type CreateAnnotationRequest = Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'> & {
  operationId?: string;
};

export type UpdateAnnotationRequest = Pick<Annotation, 'geometry' | 'style'> & {
  text?: string;
  fontSize?: number;
};
