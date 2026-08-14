# Test Plan: viewer-full-matrix

## Goal

검증 대상은 PDF 뷰어의 입력 처리와 상태 복원 전체다. 페이지 렌더링 자체와 입력 상태 전이를 분리해, 한 기능의 수정이 다른 조합의 동작을 바꾸지 않는지 확인한다.

## State axes

| 축 | 값 | 계약 |
| --- | --- | --- |
| 표시 모드 | `scroll`, `single`, `double` | `scroll`만 native scroll을 허용하고, 나머지는 wheel을 페이지 이동으로 소비한다. |
| 입력 | scrollbar/native scroll, page input, arrow/PageUp/PageDown, wheel, Ctrl+wheel | 모든 페이지 이동은 1-based 정규화 규칙을 공유한다. |
| 페이지 수 | 1, 2, 3, 6+ | 시작/끝 경계, 짝수/홀수 문서를 모두 포함한다. |
| UI 상태 | visible, hidden | Space와 화면 중앙 1/9 클릭은 입력 컨트롤을 건드리지 않고 같은 UI 모델 전이만 토글한다. |
| 화면 상태 | normal, inverted | inversion은 모드·페이지·스크롤과 독립적이다. |
| 순서 | mode→input, input→mode, hide→input→show, zoom→mode→wheel | wheel 누적값은 모드 전환 때 폐기한다. |

## Scenario matrix

| ID | 시나리오 | 검증 포인트 |
| --- | --- | --- |
| VM-01 | 각 모드에서 page input으로 첫/중간/마지막/범위 밖 페이지 이동 | `double`은 홀수 spread anchor로 정규화된다. |
| VM-02 | 각 모드에서 ArrowLeft/Right, ArrowUp/Down, PageUp/Down | 방향과 경계가 동일한 순수 전이 규칙을 사용한다. |
| VM-03 | 입력 필드에 포커스한 상태에서 키 입력 | 전역 키보드 핸들러가 입력을 소비하지 않는다. |
| VM-04 | `scroll`에서 작은/큰 wheel과 scrollbar | wheel은 preventDefault하지 않고 native scroll만 현재 페이지를 갱신한다. |
| VM-05 | `single`에서 10+20, 900, -900 wheel | 30 threshold, 1페이지 step, 경계 고정, 누적값 초기화를 검증한다. |
| VM-06 | `double`에서 같은 wheel 입력 | 2페이지 step과 홀수 anchor를 검증한다. |
| VM-07 | 각 모드에서 Ctrl+wheel | 페이지 이동 없이 zoom effect만 발생한다. |
| VM-08 | partial wheel→mode switch→partial wheel | 이전 모드의 wheel remainder가 새 모드로 새지 않는다. |
| VM-09 | Space 및 화면 중앙 1/9 클릭 hide/show를 mode, wheel, keyboard 앞뒤에 배치 | 중앙 셀 밖 클릭과 북마크 추가 모드의 중앙 클릭은 무시하며 UI visibility가 page/mode/scroll 상태를 변경하지 않는다. |
| VM-10 | inversion을 mode/scroll/page 이동 앞뒤에 배치 | canvas filter만 바뀌고 navigation state는 보존된다. |
| VM-11 | resize와 fit width/height 후 mode/wheel | layout 재계산이 입력 모델의 페이지·wheel 상태를 덮지 않는다. |
| VM-12 | 저장 상태 복원 후 mode/page/scroll/UI/inversion 재진입 | 서버 payload와 화면 projection이 일치한다. |

## Automated layers

1. `F:\dev\pdfgpu\packages\pdfgpu\tests\interaction.test.mjs`는 VM-01~VM-08의 순수 상호작용 전이를, `npm run test:pdfgpu`는 PDFit artifact integration을 실행한다.
2. `npm run verify:pdfit:acceptance -- --group F`는 VM-01~VM-12를 실제 Chromium에서 렌더링된 UI와 persisted viewer state로 실행한다.
3. `npm run verify:repo`, `npm run build`, Docker health, browser report를 모두 통과해야 완료로 판단한다.

## Pass criteria

* 순수 모델 테스트가 0 failures다.
* group F가 3개 시나리오 모두 통과하고 console/page error가 0개다.
* `scroll`은 native scroll, `single/double`은 page wheel이라는 구분이 모든 구현 경로(GPU/legacy fallback)에 동일하다.
* GPU와 legacy는 공통 interaction module 외에 페이지 정규화·키보드·wheel threshold 로직을 재구현하지 않는다.
