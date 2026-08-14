import { useCallback, useEffect, useRef, useState } from 'react';
import { progressApi } from '../api/progress';

const DEBOUNCE_MS = 2000;

/**
 * PDF 읽기 진행 상태를 서버와 동기화하는 훅.
 * - 마운트 시 마지막 읽은 페이지를 서버에서 로드
 * - reportPage() 호출 시 디바운스 후 서버에 저장
 *   (DEBOUNCE_MS 내 마지막 값만 전송, 이전 전송값과 같으면 스킵)
 */
export function usePageProgress(folder: string, filename: string) {
  const [savedPage, setSavedPage] = useState<number | null>(null);

  const lastSentRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 마지막 읽은 페이지 로드
  useEffect(() => {
    if (!folder || !filename) return;
    progressApi.get(folder, filename).then((page) => {
      setSavedPage(page);
    });
  }, [folder, filename]);

  // 언마운트 시 타이머 정리 및 즉시 플러시
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [folder, filename]);

  const reportPage = useCallback(
    (page: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (lastSentRef.current === page) return; // 이전 전송값과 동일하면 스킵
        lastSentRef.current = page;
        progressApi.save(folder, filename, page);
      }, DEBOUNCE_MS);
    },
    [folder, filename],
  );

  return { savedPage, reportPage };
}
