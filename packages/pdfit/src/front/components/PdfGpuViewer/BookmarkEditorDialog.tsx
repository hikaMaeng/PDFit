import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Slider, Switch, TextField, Typography } from '@mui/material';
import type { BookmarkRecord, UpdateBookmarkRequest } from '../../../common/protocol/bookmarks/index.js';

const BOOKMARK_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#a855f7'];

type Props = {
  bookmark: BookmarkRecord | null;
  draft: UpdateBookmarkRequest;
  onDraftChange: (draft: UpdateBookmarkRequest) => void;
  onClose: () => void;
  onSave: () => void;
};

/** Bookmark color, opacity, and comment editor. */
export function BookmarkEditorDialog({ bookmark, draft, onDraftChange, onClose, onSave }: Props) {
  return <Dialog data-testid="bookmark-editor" open={Boolean(bookmark)} onClose={onClose} fullWidth maxWidth="xs">
    <DialogTitle>북마크 수정</DialogTitle>
    <DialogContent sx={{ display: 'grid', gap: 2, pt: 2 }}>
      <Box><Typography variant="body2" sx={{ mb: 1 }}>외곽선 색상</Typography><Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>{BOOKMARK_COLORS.map((color) => <Box data-testid={`bookmark-border-color-${color.slice(1)}`} component="button" type="button" key={color} onClick={() => onDraftChange({ ...draft, borderColor: color })} sx={{ width: 26, height: 26, borderRadius: '50%', border: draft.borderColor === color ? '3px solid #111' : '1px solid #ddd', bgcolor: color, cursor: 'pointer' }} />)}</Box></Box>
      <FormControlLabel control={<Switch checked={Boolean(draft.fillColor)} onChange={(_, checked) => onDraftChange({ ...draft, fillColor: checked ? draft.fillColor ?? '#f59e0b' : null })} />} label="내부 칠색상" />
      {draft.fillColor && <Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>{BOOKMARK_COLORS.map((color) => <Box data-testid={`bookmark-fill-color-${color.slice(1)}`} component="button" type="button" key={color} onClick={() => onDraftChange({ ...draft, fillColor: color })} sx={{ width: 26, height: 26, borderRadius: '50%', border: draft.fillColor === color ? '3px solid #111' : '1px solid #ddd', bgcolor: color, cursor: 'pointer' }} />)}</Box>
        <Typography variant="body2">칠 투명도</Typography>
        <Slider value={draft.fillOpacity ?? 0.2} min={0} max={1} step={0.05} valueLabelDisplay="auto" onChange={(_, value) => onDraftChange({ ...draft, fillOpacity: value as number })} />
      </Box>}
      <TextField label="코멘트" value={draft.comment ?? ''} onChange={(event) => onDraftChange({ ...draft, comment: event.target.value || null })} multiline minRows={3} />
    </DialogContent>
    <DialogActions><Button onClick={onClose}>취소</Button><Button variant="contained" onClick={onSave}>저장</Button></DialogActions>
  </Dialog>;
}
