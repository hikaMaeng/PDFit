import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerStateApi, ViewerStatePayload } from '../api/viewerState';

const DEBOUNCE_MS = 800;

/**
 * 책별 뷰어 전체 상태를 서버와 동기화하는 훅.
 * - 마운트 시 서버에서 저장된 상태 로드 (없으면 null)
 * - reportState() 호출 시 디바운스 후 서버에 저장
 *   (DEBOUNCE_MS 내 마지막 값만 전송, 이전 전송값과 동일하면 스킵)
 */
export function useViewerState(folder: string, filename: string) {
  const [savedState, setSavedState] = useState<ViewerStatePayload | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);

  const lastSentRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 저장된 상태 로드
  useEffect(() => {
    if (!folder || !filename) return;
    setStateLoaded(false);
    viewerStateApi.get(folder, filename).then((state) => {
      setSavedState(state);
      setStateLoaded(true);
    });
  }, [folder, filename]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [folder, filename]);

  const reportState = useCallback(
    (state: ViewerStatePayload) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const key = JSON.stringify(state);
        if (lastSentRef.current === key) return; // 이전 전송값과 동일하면 스킵
        lastSentRef.current = key;
        viewerStateApi.save(folder, filename, state);
      }, DEBOUNCE_MS);
    },
    [folder, filename],
  );

  return { savedState, stateLoaded, reportState };
}
