import type { AnnotationStyle } from '../../../common/protocol/annotations/index.js';
import type { AnnotationPageProjection } from '../../annotation/coordinates.js';
import { pageRectToLayerRect } from '../../annotation/coordinates.js';

export type AnnotationTextDraft = { id: string | null; pageIndex: number; point: { x: number; y: number }; width: number; height: number; fontSize: number; text: string };

type Props = {
  draft: AnnotationTextDraft;
  projection: AnnotationPageProjection;
  style: AnnotationStyle;
  onChange: (draft: AnnotationTextDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
};

/** HTML text editor projected into the SVG annotation surface. */
export function AnnotationTextEditor({ draft, projection, style, onChange, onCommit, onCancel }: Props) {
  const rect = pageRectToLayerRect(projection, { ...draft.point, width: draft.width, height: draft.height });
  return <foreignObject data-testid="annotation-text-editor" x={rect.x} y={rect.y} width={Math.max(rect.width, 120)} height={Math.max(rect.height, 64)} style={{ overflow: 'visible', pointerEvents: 'all' }}>
    <textarea aria-label="annotation text editor" autoFocus value={draft.text} onChange={(event) => onChange({ ...draft, text: event.target.value })} onBlur={onCommit} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); onCommit(); }
    }} style={{ boxSizing: 'border-box', width: '100%', height: '100%', resize: 'none', border: '1px solid #2563eb', outline: 'none', padding: 4, color: style.color, background: 'rgba(255,255,255,.9)', fontSize: `${draft.fontSize * projection.scaleY}px`, lineHeight: 1.25 }} />
  </foreignObject>;
}
