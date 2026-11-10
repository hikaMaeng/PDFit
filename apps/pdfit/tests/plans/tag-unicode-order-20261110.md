# 사이드바 태그 유니코드 순 정렬 검증 계획

## 목적

사이드바(LNB) 태그 목록이 서점 분류 그룹 순서가 아니라 태그 이름의 유니코드(UTF-16 코드 유닛) 순으로 표시되는지 검증한다.

## 요구 기준 (사용자 요청 원문)

> 태그의 정렬이 이상해 유니코드 순으로 정렬되게 수정하라

## 환경

- Windows 11, root `docker-compose.yml`의 `pdfit`(Free, `npm run deploy:standalone`) 컨테이너
- URL: `http://localhost:15203/folder/PDFit%20Library`
- Chromium headless 1380×900. 이 PC에는 Playwright 기대 빌드가 없어 `PDFIT_TEST_CHROMIUM_PATH`로 설치된 `chromium_headless_shell-1217`을 지정한다.

## 절차

1. `/api/tags/summary`를 일부러 뒤섞인 25개 태그(숫자·대문자·소문자·기호·한글 혼합)로 모킹한다.
2. 폴더 화면을 열고 `.pdfit-tag-row`의 이름을 순서대로 수집한다.
3. 기대값은 입력 이름을 코드 유닛 비교(`<`, `>`)로 정렬한 배열이다.
4. 숫자 < 대문자 < 소문자 < 한글, `AWS` < `Android`, 한글 가나다순을 개별 단언으로 확인한다.
5. console error와 pageerror를 수집한다.

실행: `node apps/pdfit/tests/tag-unicode-order-browser.mjs`

## 합격 기준

- 태그가 누락·중복 없이 유니코드 순으로 표시된다.
- 서점 분류 그룹이나 로케일 정렬 순서가 섞이지 않는다.
- 브라우저 오류가 없다.

## 추가 (2026-11-10): 태그 아이콘

사용자 요청: "#은 의미가 없기 때문에 태그 리스트의 아이템 앞에는 태그아이콘을 대체하고 #을 제거한다."

- 각 `.pdfit-tag-row`에 `data-testid="lnb-tag-icon"`이 정확히 하나씩 있다.
- 태그 이름 텍스트가 `#`으로 시작하지 않는다.
- 아이콘 색은 태그 색상(`tag.color`, 모킹 `#3b82f6` → `rgb(59, 130, 246)`)을 따른다.
