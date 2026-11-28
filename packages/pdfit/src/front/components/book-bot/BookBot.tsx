import { memo, useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Link, List, ListItem, ListItemButton, Paper, Stack, TextField, Tooltip, Typography } from '@mui/material';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import HistoryIcon from '@mui/icons-material/History';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import Markdown from 'react-markdown';
import { BOOK_BOT_QUESTION_LIMIT } from '../../../common/protocol/book-bot/index.js';
import { usePdfitI18n } from '../../i18n/usePdfitI18n.js';
import { useViewerPopupGeometry } from '../../hooks/useViewerPopupGeometry.js';
import { VIEWER_POPUP_CLOSE_INSET, ViewerPopupCloseButton } from '../viewer-popup/ViewerPopupCloseButton.js';
import { ViewerPopupResizeHandle } from '../viewer-popup/ViewerPopupResizeHandle.js';
import { ToolbarButton } from '../ViewerToolbar/index.js';
import type { getBookBotModel } from './model.js';
import { BOT } from './resource.js';
import { pdfPageFromCitation, remarkPdfPageCitations } from './pageCitations.js';

type Model = ReturnType<typeof getBookBotModel>;
type ToolProps = { model: Model; buttonId: string; panelId: string };
type PageNavigation = { pageCount: number; onPage: (page: number) => void };
type PanelProps = ToolProps & PageNavigation & { documentUrl: string };

export function BookBotButton({ model, buttonId, panelId, documentUrl }: ToolProps & { documentUrl: string }) {
  const { t } = usePdfitI18n();
  useSyncExternalStore(model.subscribe, () => model.open, () => model.open);
  return <ToolbarButton id={buttonId} icon={<SmartToyOutlinedIcon />} caption={t(BOT.BUTTON)} label={t(BOT.BUTTON)}
    aria-haspopup="dialog" aria-expanded={model.open} aria-controls={model.open ? panelId : undefined}
    color={model.open ? 'primary' : 'default'} onClick={() => model.toggle(documentUrl)} />;
}

export function BookBotPanel(props: PanelProps) {
  const { model } = props;
  useSyncExternalStore(model.subscribe, () => model.open, () => model.open);
  return model.open ? <FloatingChat {...props} /> : null;
}

const errorKeys = { load: BOT.LOAD_ERROR, send: BOT.SEND_ERROR, settings: BOT.SETTINGS_ERROR, conflict: BOT.CONFLICT };

function FloatingChat({ model, buttonId, panelId, documentUrl, pageCount, onPage }: PanelProps) {
  const { t } = usePdfitI18n();
  const titleId = useId();
  const { popupRef, rect, moveHandleProps, resizeHandleProps } = useViewerPopupGeometry({
    kind: 'bot', bookKey: model.popupBookKey, open: true, minWidth: 320, minHeight: 300,
    defaultRect: ({ width }) => ({ x: width - 488, y: 12, width: 480, height: 600 }),
  });
  const headingRef = useRef<HTMLDivElement>(null);
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const close = () => {
    model.close();
    document.getElementById(buttonId)?.focus();
  };
  const busy = model.phase !== 'ready';
  return <Paper ref={popupRef} id={panelId} role="dialog" aria-modal={false} aria-labelledby={titleId} elevation={16}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === 'Escape') close();
    }}
    sx={{
      position: 'absolute', left: rect.x, top: rect.y, zIndex: 27, display: 'flex', flexDirection: 'column',
      width: rect.width, height: rect.height, boxSizing: 'border-box',
      border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden',
      bgcolor: 'background.paper', backgroundImage: 'none',
    }}>
    <Stack direction="row" alignItems="center" gap={0.25} sx={{ direction: 'ltr', pl: 1, paddingRight: VIEWER_POPUP_CLOSE_INSET,
      py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      <Box ref={headingRef} {...moveHandleProps} tabIndex={0} title={t(BOT.MOVE)}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
        sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'grab', touchAction: 'none', userSelect: 'none', p: 0.5 }}>
        <DragIndicatorIcon fontSize="small" color="action" />
        <SmartToyOutlinedIcon fontSize="small" color="primary" />
        <Typography id={titleId} component="h2" variant="subtitle2" fontWeight={700}>{t(BOT.BUTTON)}</Typography>
        {model.session?.title && !model.history &&
          <Typography variant="caption" color="text.secondary" title={model.session.title} noWrap dir="auto">{model.session.title}</Typography>}
      </Box>
      <Tooltip title={t(model.history ? BOT.CHAT : BOT.HISTORY)}>
        <span><IconButton size="small" disabled={busy} aria-label={t(model.history ? BOT.CHAT : BOT.HISTORY)}
          onClick={() => model.history ? model.showChat() : void model.loadHistory()}>
          {model.history ? <ArrowBackIcon fontSize="small" /> : <HistoryIcon fontSize="small" />}
        </IconButton></span>
      </Tooltip>
      <Tooltip title={t(BOT.NEW)}>
        <span><IconButton size="small" disabled={busy} aria-label={t(BOT.NEW)} onClick={() => void model.newSession()}>
          <AddCommentOutlinedIcon fontSize="small" />
        </IconButton></span>
      </Tooltip>
      <ViewerPopupCloseButton onClose={close} />
    </Stack>
    {model.phase === 'loading' && <Typography role="status" color="text.secondary" sx={{ px: 2, py: 1 }}>{t(BOT.LOADING)}</Typography>}
    {model.error && <Alert severity="error" sx={{ mx: 1, mt: 1 }} action={model.error === 'load'
      ? <Button size="small" onClick={() => model.retry()}>{t('retry')}</Button> : undefined}>{t(errorKeys[model.error])}</Alert>}
    {model.history ? <SessionList model={model} /> :
      <Conversation model={model} documentUrl={documentUrl} pageCount={pageCount} onPage={onPage} />}
    <ViewerPopupResizeHandle {...resizeHandleProps} />
  </Paper>;
}

function SessionList({ model }: { model: Model }) {
  const { t, language } = usePdfitI18n();
  const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
  return <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0, px: 1 }}>
    {model.phase === 'ready' && !model.error && model.sessions.length === 0 &&
      <Typography color="text.secondary" sx={{ p: 2 }}>{t(BOT.NO_HISTORY)}</Typography>}
    <List aria-label={t(BOT.HISTORY)} disablePadding>
      {model.sessions.map((session) => <ListItem key={session.id} disablePadding>
        <ListItemButton component="button" disabled={model.phase !== 'ready'} selected={session.id === model.session?.id}
          onClick={() => void model.loadSession(session.id)} sx={{ alignItems: 'start', flexDirection: 'column', py: 1.25, textAlign: 'start' }}>
          <Typography variant="body2" fontWeight={600} dir="auto">{session.title ?? t(BOT.UNTITLED)}</Typography>
          <Typography component="time" dateTime={session.createdAt} variant="caption" color="text.secondary">
            {format.format(new Date(session.createdAt))}
          </Typography>
        </ListItemButton>
      </ListItem>)}
    </List>
  </Box>;
}

const progressLabels = {
  preparing: BOT.PREPARING, clips: BOT.CLIPS, history: BOT.HISTORY_PROGRESS, evidence: BOT.EVIDENCE,
  queued: BOT.QUEUED, analyzing: BOT.ANALYZING, loadingPages: BOT.LOADING_PAGES,
  generating: BOT.GENERATING, thinking: BOT.THINKING, saving: BOT.SAVING,
} as const;
const citationPlugins = [remarkPdfPageCitations];

function Conversation({ model, documentUrl, pageCount, onPage }: PageNavigation & { model: Model; documentUrl: string }) {
  const { t } = usePdfitI18n();
  const logRef = useRef<HTMLDivElement>(null);
  const followEnd = useRef(true);
  const turns = model.session?.turns ?? [];
  const busy = model.phase !== 'ready';
  const progress = model.progress;
  const progressText = progress
    ? t(progressLabels[progress.phase === 'thinking' && model.pendingAnswer ? 'generating' : progress.phase],
      'completed' in progress ? { completed: progress.completed, total: progress.total } : undefined)
    : t(BOT.WAITING);
  useEffect(() => {
    followEnd.current = true;
  }, [model.pending, model.session?.id]);
  useEffect(() => {
    if (followEnd.current && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [model.pending, model.pendingAnswer, model.session, progress]);
  return <>
    <Stack ref={logRef} role="log" aria-label={t(BOT.CHAT)} gap={1.5}
      onScroll={(event) => {
        const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
        followEnd.current = scrollHeight - scrollTop - clientHeight < 48;
      }}
      sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 1.5, py: 1.5 }}>
      {turns.length === 0 && !model.pending && model.phase !== 'loading' &&
        <Typography color="text.secondary" sx={{ px: 0.5 }}>{t(BOT.EMPTY)}</Typography>}
      {turns.map((turn) => <Stack key={turn.id} gap={1.25}>
        <ChatMessage author={t(BOT.YOU)} text={turn.question} reader />
        {turn.answer
          ? <ChatMessage author={t(BOT.BUTTON)} text={turn.answer} pageCount={pageCount} onPage={onPage} />
          : <Alert severity="error">{t(BOT.SEND_ERROR)}</Alert>}
      </Stack>)}
      {model.pending && <ChatMessage author={t(BOT.YOU)} text={model.pending} reader />}
      {model.pendingAnswer && <ChatMessage author={t(BOT.BUTTON)} text={model.pendingAnswer} pageCount={pageCount} onPage={onPage} streaming />}
      {model.phase === 'sending' && <Stack role="status" direction="row" alignItems="center" gap={1} sx={{ color: 'text.secondary' }}>
        <CircularProgress size={14} aria-hidden="true" />
        <Typography variant="body2">{progressText}</Typography>
      </Stack>}
    </Stack>
    <Stack component="form" direction="row" gap={0.75} alignItems="end"
      onSubmit={(event) => { event.preventDefault(); void model.send(documentUrl); }}
      sx={{ borderTop: 1, borderColor: 'divider', p: 1, pr: 3, bgcolor: 'background.paper' }}>
      <TextField size="small" multiline minRows={2} maxRows={4} fullWidth
        disabled={busy || model.error === 'load'} label={t(BOT.QUESTION)} value={model.draft}
        inputProps={{ maxLength: BOOK_BOT_QUESTION_LIMIT, dir: 'auto' }}
        onChange={(event) => model.edit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault();
            void model.send(documentUrl);
          }
        }} />
      <Tooltip title={t(BOT.SEND)}>
        <span><IconButton type="submit" color="primary" aria-label={t(BOT.SEND)}
          disabled={busy || model.error === 'load' || !model.draft.trim()}><SendOutlinedIcon /></IconButton></span>
      </Tooltip>
    </Stack>
  </>;
}

const ChatMessage = memo(function ChatMessage({ author, text, reader = false, streaming = false, pageCount = 0, onPage }: {
  author: string; text: string; reader?: boolean; streaming?: boolean;
} & Partial<PageNavigation>) {
  const { t } = usePdfitI18n();
  return <Box aria-live={streaming ? 'off' : undefined} sx={{ alignSelf: reader ? 'end' : 'start', maxWidth: '94%', px: 1.25, py: 0.85, borderRadius: 2,
    bgcolor: reader ? 'action.selected' : 'action.hover', overflowWrap: 'anywhere' }}>
    <Typography variant="caption" fontWeight={700} color="text.secondary">{author}</Typography>
    <Box dir="auto" sx={{ fontSize: '0.875rem', whiteSpace: reader ? 'pre-wrap' : undefined, '& p': { my: 0.55 },
      '& pre': { whiteSpace: 'pre-wrap' }, '& ul, & ol': { paddingInlineStart: '1.5em' }, '& > :last-child': { mb: 0 } }}>
      {reader ? text : <Markdown skipHtml disallowedElements={['img']} unwrapDisallowed remarkPlugins={citationPlugins}
        components={{
          a: ({ href, children }) => {
            const page = pdfPageFromCitation(href);
            if (href?.startsWith('/viewer/')) {
              const route = new URL(href, 'http://localhost');
              if (/^\/viewer\/[^/?#]+\/[^/?#]+(?:\?page=[1-9]\d*)?$/.test(route.pathname + route.search)) {
                return <Link href={href}>{children}</Link>;
              }
            }
            if (!onPage || page === null || page > pageCount) return <>{children}</>;
            return <Link href={href} title={t(BOT.GO_TO_PAGE, { page })} onClick={(event) => {
              event.preventDefault();
              onPage(page);
            }}>{children}</Link>;
          },
        }}>{text}</Markdown>}
    </Box>
  </Box>;
});
