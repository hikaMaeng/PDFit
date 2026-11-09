import { SvgIcon, type SvgIconProps } from '@mui/material';

/** 태그 외곽과 내부 # 기호로 태그 탐색을 표시한다. */
export default function HashTagIcon(props: SvgIconProps) {
  return <SvgIcon {...props} data-testid="HashTagIcon" viewBox="0 0 24 24">
    <path d="M3 3h9l9 9-9 9-9-9Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <circle cx="6.5" cy="6.5" r="1" />
    <path d="m11 9-2 8m6-8-2 8M8.5 11.5h8m-9 3h8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </SvgIcon>;
}
