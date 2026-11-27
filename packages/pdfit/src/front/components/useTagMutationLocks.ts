import { useCallback, useMemo, useRef, useState } from 'react';
import type { AiModelProgress } from '../../common/protocol/ai-model/index.js';

/**
 * 한 번에 돌릴 수 있는 AI 자동 태그 수. 한 권 분류에 수십 초에서 수 분이 걸리므로
 * 화면 전체를 잠그는 대신 이 수만큼 동시에 돌리고, 그 이상은 버튼을 잠가 AI 처리
 * 사용량이 한꺼번에 빠져나가지 않게 막는다.
 */
export const AUTO_TAG_CONCURRENCY = 4;

/** 한 책에 대해 동시에 돌 수 없는 작업 종류. 둘 다 그 책의 태그 집합을 바꾼다. */
export type TagMutationScope = 'ai' | 'tag';

export interface TagMutationLocks {
  /** 이 책에 대해 진행 중인 태그 작업(AI·수동)이 있는지. */
  isBookBusy: (bookKey: string) => boolean;
  /** 이 책의 AI 자동 태그가 진행 중인지(스피너 표시용). */
  isAutoTagging: (bookKey: string) => boolean;
  /** AI 동시 실행이 상한에 찼는지. 진행 중이 아닌 책의 AI 버튼만 잠근다. */
  autoTagSlotsFull: boolean;
  autoTagPhase: (bookKey: string) => AiModelProgress | undefined;
  setAutoTagPhase: (bookKey: string, phase: AiModelProgress) => void;
  /** 진행 중인 작업이 하나라도 있는지(폴더 단위 작업이 기다려야 하는 경우에만 쓴다). */
  anyBusy: boolean;
  /** 잠금을 얻으면 true. 같은 책이 이미 작업 중이거나 AI 상한에 걸리면 false. */
  begin: (scope: TagMutationScope, bookKey: string) => boolean;
  end: (scope: TagMutationScope, bookKey: string) => void;
}

/**
 * 책 목록 화면의 태그 작업 잠금. 예전에는 화면마다 `tagMutation` 토큰 하나로
 * 페이지 전체를 잠가서, 한 권의 AI 자동 태그가 도는 동안 다른 모든 책의 AI 버튼과
 * 태그 추가·삭제까지 멈췄다. 잠금 단위는 책이어야 충분하다. 낙관적 갱신이 엉키는
 * 것은 같은 책에 두 작업이 겹칠 때뿐이기 때문이다.
 *
 * 획득 판정은 ref로 한다. 같은 렌더에서 연달아 들어온 두 클릭이 state 갱신을
 * 기다리는 사이에 둘 다 통과하면 안 되기 때문이고, 화면 갱신용 복사본을 state로
 * 따로 들고 간다.
 */
export function useTagMutationLocks(): TagMutationLocks {
  const heldRef = useRef(new Map<string, AiModelProgress | undefined>());
  const [held, setHeld] = useState<ReadonlyMap<string, AiModelProgress | undefined>>(() => new Map());
  const publish = useCallback(() => setHeld(new Map(heldRef.current)), []);

  const begin = useCallback((scope: TagMutationScope, bookKey: string) => {
    const current = heldRef.current;
    if (current.has(`ai:${bookKey}`) || current.has(`tag:${bookKey}`)) return false;
    if (scope === 'ai') {
      let running = 0;
      for (const key of current.keys()) if (key.startsWith('ai:')) running += 1;
      if (running >= AUTO_TAG_CONCURRENCY) return false;
    }
    current.set(`${scope}:${bookKey}`, undefined);
    publish();
    return true;
  }, [publish]);

  const end = useCallback((scope: TagMutationScope, bookKey: string) => {
    heldRef.current.delete(`${scope}:${bookKey}`);
    publish();
  }, [publish]);

  const autoTagSlotsFull = useMemo(() => {
    let running = 0;
    for (const key of held.keys()) if (key.startsWith('ai:')) running += 1;
    return running >= AUTO_TAG_CONCURRENCY;
  }, [held]);

  const isBookBusy = useCallback((bookKey: string) => held.has(`ai:${bookKey}`) || held.has(`tag:${bookKey}`), [held]);
  const isAutoTagging = useCallback((bookKey: string) => held.has(`ai:${bookKey}`), [held]);

  const autoTagPhase = useCallback((bookKey: string) => held.get(`ai:${bookKey}`), [held]);
  const setAutoTagPhase = useCallback((bookKey: string, phase: AiModelProgress) => {
    const key = `ai:${bookKey}`;
    if (!heldRef.current.has(key) || heldRef.current.get(key) === phase) return;
    heldRef.current.set(key, phase);
    publish();
  }, [publish]);
  return { isBookBusy, isAutoTagging, autoTagPhase, setAutoTagPhase, autoTagSlotsFull, anyBusy: held.size > 0, begin, end };
}
