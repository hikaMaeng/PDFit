import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Box, Chip, CircularProgress, Typography } from '@mui/material';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined';
import ViewQuiltOutlinedIcon from '@mui/icons-material/ViewQuiltOutlined';
import { tagsApi, type TagIndexEntry } from '../api/tags';
import { usePdfitI18n, useTranslatedDisplayText } from '../i18n/usePdfitI18n';
import { openViewer, viewerUrl } from '../viewer/openViewer';

/** 카드 안에서 보여 줄 책 제목은 파일명에서 `.pdf`를 뺀 값이다(검색 기능의 "제목"과 같은 규칙). */
const bookTitle = (filename: string) => filename.replace(/\.pdf$/i, '');

function TagName({ value }: { value: string }) {
  return <>{useTranslatedDisplayText(value)}</>;
}

interface IndexCard {
  name: string;
  color: string;
  books: Array<{ folder: string; filename: string; driveFileId?: string; title: string }>;
}

/** 카드 사이 간격(px)과 한 단의 최소 너비(px). 단 수는 화면 너비로 정한다. */
const CARD_GAP = 16;
const MIN_COLUMN_WIDTH = 250;

interface MasonryLayout {
  positions: Array<{ left: number; top: number }>;
  height: number;
}

const sameLayout = (left: MasonryLayout, right: MasonryLayout) => left.height === right.height
  && left.positions.length === right.positions.length
  && left.positions.every((position, index) => position.left === right.positions[index].left && position.top === right.positions[index].top);

/**
 * `/tag-index` — 모든 태그를 카드 한 장씩으로 놓고, 카드 안에 그 태그가 붙은 책 제목을 작은 글씨로 나열한다.
 * 태그마다 책 수가 제각각이므로 핀터레스트처럼 쌓는다: 카드를 순서대로 왼쪽에서 오른쪽으로 한 줄 놓고,
 * 그다음 카드부터는 그때 가장 낮은(바닥이 가장 위인) 단 아래에 놓는다(같으면 왼쪽 단). 카드 높이는
 * 실제로 재서 위치를 정하므로(`position: absolute`) DOM 순서는 태그 순서 그대로다.
 * 같은 책이 여러 태그를 가지면 그 태그들의 카드마다 나온다.
 */
export default function TagIndexPage() {
  const { t, ui } = usePdfitI18n();
  const [entries, setEntries] = useState<TagIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCurrent: () => boolean) => {
    try {
      const data = await tagsApi.listIndex();
      if (!isCurrent()) return;
      setEntries(data);
      setError(null);
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : ui('로드 실패'));
    }
  }, [ui]);

  useEffect(() => {
    let current = true;
    const isCurrent = () => current;
    void load(isCurrent);
    // 태그·폴더가 바뀌면(사이드바에서 삭제, 다른 창에서 태그 추가 등) 조용히 다시 읽는다.
    const refresh = () => void load(isCurrent);
    window.addEventListener('tags-changed', refresh);
    window.addEventListener('folders-changed', refresh);
    return () => {
      current = false;
      window.removeEventListener('tags-changed', refresh);
      window.removeEventListener('folders-changed', refresh);
    };
  }, [load]);

  // 카드는 사이드바 태그 목록과 같은 순서(이름의 UTF-16 코드 유닛 순), 카드 안 책은 제목 순(숫자는 수 크기 순)이다.
  const cards = useMemo<IndexCard[]>(() => (entries ?? [])
    .filter((entry) => entry.books.length > 0)
    .map((entry) => ({
      name: entry.name,
      color: entry.color,
      books: entry.books
        .map((book) => ({ ...book, title: bookTitle(book.filename) }))
        .sort((left, right) => left.title.localeCompare(right.title, 'ko', { numeric: true }) || left.folder.localeCompare(right.folder, 'ko')),
    }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)), [entries]);
  const linkTotal = useMemo(() => cards.reduce((total, card) => total + card.books.length, 0), [cards]);

  // ── 핀터레스트 배치: 단 너비는 컨테이너 너비로, 위치는 잰 카드 높이로 정한다 ──
  const gridRef = useRef<HTMLUListElement | null>(null);
  const cardRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [gridWidth, setGridWidth] = useState(0);
  const [layout, setLayout] = useState<MasonryLayout>({ positions: [], height: 0 });
  const columns = Math.max(1, Math.floor((gridWidth + CARD_GAP) / (MIN_COLUMN_WIDTH + CARD_GAP)));
  const columnWidth = gridWidth > 0 ? (gridWidth - CARD_GAP * (columns - 1)) / columns : 0;

  const place = useCallback(() => {
    if (columnWidth <= 0) return;
    const bottoms = new Array<number>(columns).fill(0);
    const positions = cards.map((_, index) => {
      let target = 0;
      for (let column = 1; column < columns; column += 1) if (bottoms[column] < bottoms[target]) target = column;
      const top = bottoms[target];
      bottoms[target] = top + (cardRefs.current[index]?.offsetHeight ?? 0) + CARD_GAP;
      return { left: target * (columnWidth + CARD_GAP), top };
    });
    const next = { positions, height: Math.max(0, Math.max(...bottoms) - CARD_GAP) };
    setLayout((current) => (sameLayout(current, next) ? current : next));
  }, [cards, columns, columnWidth]);

  const gridMounted = cards.length > 0;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return undefined;
    setGridWidth(grid.clientWidth);
    const observer = new ResizeObserver(() => setGridWidth(grid.clientWidth));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridMounted]);

  useLayoutEffect(() => { place(); }, [place]);

  // 태그 이름 번역이나 글꼴 로딩으로 카드 높이가 바뀌면 다시 놓는다.
  useEffect(() => {
    const observer = new ResizeObserver(() => place());
    for (const element of cardRefs.current) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [place, cards]);

  const layoutReady = columnWidth > 0 && layout.positions.length === cards.length;

  return (
    <Box data-testid="tag-index-page" sx={{ py: 0.5 }}>
      <Box sx={{ px: 1, mb: 1.5, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
        <ViewQuiltOutlinedIcon aria-hidden sx={{ fontSize: 30, color: 'primary.main' }} />
        <Typography component="h1" variant="h5" fontWeight={700}>{t('tagIndex')}</Typography>
        {entries && cards.length > 0 && (
          <Chip
            data-testid="tag-index-summary"
            label={t('tagIndexSummary', { tags: cards.length, links: linkTotal })}
            size="small"
            color="primary"
            variant="outlined"
            sx={{ borderRadius: '4px', fontWeight: 600, maxWidth: '100%' }}
          />
        )}
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      {!entries && !error ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}><CircularProgress /></Box>
      ) : entries && cards.length === 0 ? (
        <Box data-testid="tag-index-empty" sx={{ py: 8, textAlign: 'center' }}>
          <LabelOutlinedIcon aria-hidden sx={{ fontSize: 44, color: 'text.disabled', mb: 1 }} />
          <Typography color="text.secondary">{t('tagIndexEmpty')}</Typography>
        </Box>
      ) : (
        <Box sx={{ px: 1 }}>
        <Box
          component="ul"
          ref={gridRef}
          data-testid="tag-index-grid"
          aria-label={t('tagIndex')}
          // 첫 배치가 끝나기 전에는 카드가 겹쳐 보이지 않도록 숨긴다(보이지 않아도 높이는 잴 수 있다).
          sx={{ listStyle: 'none', m: 0, p: 0, position: 'relative', height: layout.height, visibility: layoutReady ? 'visible' : 'hidden' }}
        >
          {cards.map((card, index) => (
            <Box
              key={card.name}
              component="li"
              ref={(element: HTMLLIElement | null) => { cardRefs.current[index] = element; }}
              data-testid="tag-index-card"
              data-tag={card.name}
              sx={{
                position: 'absolute',
                boxSizing: 'border-box',
                width: columnWidth,
                left: layout.positions[index]?.left ?? 0,
                top: layout.positions[index]?.top ?? 0,
                border: '1px solid',
                borderColor: 'divider',
                borderTop: `3px solid ${card.color}`,
                borderRadius: 1,
                bgcolor: 'background.paper',
                overflow: 'hidden',
              }}
            >
              <Box
                component={Link}
                to={`/tag/${encodeURIComponent(card.name)}`}
                data-testid="tag-index-card-title"
                aria-label={t('tagIndexTagBooks', { name: card.name })}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  px: 1.25,
                  py: 1,
                  color: 'text.primary',
                  textDecoration: 'none',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                  '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                }}
              >
                <LocalOfferOutlinedIcon aria-hidden sx={{ fontSize: 16, flexShrink: 0, color: card.color }} />
                <Typography component="h2" variant="subtitle2" fontWeight={700} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', lineHeight: 1.3 }}>
                  <TagName value={card.name} />
                </Typography>
                <Typography data-testid="tag-index-card-count" variant="caption" sx={{ color: 'text.secondary', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {card.books.length}
                </Typography>
              </Box>
              <Box component="ul" aria-label={card.name} sx={{ listStyle: 'none', m: 0, p: 0.5 }}>
                {card.books.map((book) => (
                  <Box component="li" key={book.driveFileId ?? `${book.folder}/${book.filename}`} sx={{ m: 0, p: 0 }}>
                    <Box
                      component="a"
                      data-testid="tag-index-book"
                      href={viewerUrl(book)}
                      title={`${book.folder} / ${book.filename}`}
                      translate="no"
                      onClick={(event: ReactMouseEvent<HTMLAnchorElement>) => {
                        if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                        event.preventDefault();
                        openViewer(book);
                      }}
                      sx={{
                        display: 'block',
                        px: 0.75,
                        py: '3px',
                        borderRadius: 0.5,
                        fontSize: '0.72rem',
                        lineHeight: 1.4,
                        color: 'text.secondary',
                        textDecoration: 'none',
                        overflowWrap: 'anywhere',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2, color: 'text.primary' },
                      }}
                    >
                      {book.title}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
        </Box>
      )}
    </Box>
  );
}
