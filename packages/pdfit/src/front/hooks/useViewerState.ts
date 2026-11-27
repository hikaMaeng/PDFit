import { useCallback, useEffect, useRef, useState } from 'react';
import { viewerStateApi, ViewerStatePayload } from '../api/viewerState';

const DEBOUNCE_MS = 800;

/**
 * 책별 뷰어 전체 상태를 서버와 동기화하는 훅.
 * - 마운트 시 서버에서 저장된 상태 로드 (없으면 null)
 * - reportState() 호출 시 디바운스 후 서버에 저장
 *   (DEBOUNCE_MS 내 마지막 값만 전송, 이전 전송값과 동일하면 스킵)
 * - 즉시 저장은 대기 중인 상태를 대체하고 저장 결과를 반환
 */
export function useViewerState(folder: string, filename: string, driveFileId?: string | null) {
  const [savedState, setSavedState] = useState<ViewerStatePayload | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);

  const lastSentRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 저장된 상태 로드
  useEffect(() => {
    if (!folder || !filename) return;
    setStateLoaded(false);
    viewerStateApi.get(folder, filename, driveFileId).then((state) => {
      setSavedState(state);
      setStateLoaded(true);
    });
  }, [driveFileId, folder, filename]);

  // 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [driveFileId, folder, filename]);

  const reportState = useCallback(
    (state: ViewerStatePayload, immediate = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (immediate) {
        const key = JSON.stringify(state);
        lastSentRef.current = key;
        return Promise.resolve(viewerStateApi.save(folder, filename, state, driveFileId, true)).catch((error) => {
          if (lastSentRef.current === key) lastSentRef.current = null;
          throw error;
        });
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const key = JSON.stringify(state);
        if (lastSentRef.current === key) return; // 이전 전송값과 동일하면 스킵
        lastSentRef.current = key;
        viewerStateApi.save(folder, filename, state, driveFileId);
      }, DEBOUNCE_MS);
    },
    [driveFileId, folder, filename],
  );

  return { savedState, stateLoaded, reportState };
}
