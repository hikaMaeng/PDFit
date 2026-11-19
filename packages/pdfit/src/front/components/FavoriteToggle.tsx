import { useSyncExternalStore } from 'react';
import { IconButton } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { favoritesModel, type FavoriteState } from '../model/favoritesModel.js';
import { usePdfitI18n } from '../i18n/usePdfitI18n.js';

export const FAVORITE_COLOR = '#fbbf24';

/**
 * 즐겨찾기 별. 채워져 있으면 즐겨찾기, 비어 있으면 아님. 자기 책의 상태만 구독하므로
 * 한 책을 토글해도 목록의 다른 카드·행은 다시 그려지지 않는다. 저장소가 즐겨찾기를
 * 지원하지 않으면(`unavailable`) 아무것도 그리지 않는다.
 * `card`는 표지 왼쪽 위(정보 버튼의 반대편), `row`는 목록 행의 파일명 앞에 놓는다.
 */
export default function FavoriteToggle({ folder, filename, variant, disabled = false }: { folder: string; filename: string; variant: 'card' | 'row'; disabled?: boolean }) {
  const { t, ui } = usePdfitI18n();
  const state = useSyncExternalStore(favoritesModel.subscribe, () => favoritesModel.stateOf(folder, filename), () => 'off' as FavoriteState);
  if (state === 'unavailable') return null;
  const on = state === 'on';
  const label = on ? t('removeFavorite') : t('addFavorite');
  const toggle = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    favoritesModel.toggle(folder, filename).catch((error: unknown) => {
      console.warn(ui('즐겨찾기를 바꾸지 못했습니다.'), error);
    });
  };
  const Icon = on ? StarIcon : StarBorderIcon;
  if (variant === 'card') {
    return <IconButton
      data-testid="favorite-toggle"
      data-favorite={on ? 'true' : 'false'}
      aria-label={label}
      aria-pressed={on}
      title={label}
      size="small"
      disabled={disabled}
      onClick={toggle}
      sx={{ position: 'absolute', top: 6, left: 6, zIndex: 1, width: 24, height: 24, p: 0, color: on ? FAVORITE_COLOR : '#fff', bgcolor: 'rgba(0,0,0,.55)', '&:hover': { bgcolor: 'rgba(0,0,0,.78)' } }}
    >
      <Icon sx={{ fontSize: 18 }} />
    </IconButton>;
  }
  return <IconButton
    data-testid="favorite-toggle"
    data-favorite={on ? 'true' : 'false'}
    aria-label={label}
    aria-pressed={on}
    title={label}
    size="small"
    disabled={disabled}
    onClick={toggle}
    sx={{ flexShrink: 0, width: 24, height: 24, p: 0, mr: .25, color: on ? FAVORITE_COLOR : 'text.disabled', '&:hover': { color: FAVORITE_COLOR } }}
  >
    <Icon sx={{ fontSize: 20 }} />
  </IconButton>;
}
