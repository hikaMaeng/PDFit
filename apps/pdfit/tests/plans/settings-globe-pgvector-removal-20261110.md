# 설정 화면 정리 — 테스트 계획 (2026-11-10)

## 요구 (사용자 지시)

1. 좌상단 톱니바퀴 두 개가 혼란스러우므로 왼쪽 톱니바퀴를 지구본으로 바꾼다.
2. 설정 안의 PGVector 탭은 무의미하다(이미지에 내장된 DB를 쓰므로 설정이 없는 것이 정상).

## 시나리오

1. 왼쪽 버튼(`lnb-preferences`)의 아이콘이 MUI `LanguageIcon`이고 접근성 이름이 `언어`이며,
   클릭하면 언어·다크/라이트 대화상자가 열린다.
2. `/settings`에는 탭이 `AI 서버` 하나뿐이고 `PGVector` 문구가 없다.
3. `GET /api/settings/pgvector`가 404, `GET /api/settings/ai-servers`는 200이다.
4. `npm run build`, `npm run verify:repo` 통과. 재배포 후 테이블 행 수가 배포 전과 같다.
5. 브라우저 콘솔 오류 0건.

## 데이터

기존 `app_settings`의 `pgvector_user`, `pgvector_password` 두 행은 지우지 않는다(읽는 코드가 없어 무해하며,
요청 범위가 UI·API 제거다). 배포 전 `pg_dump` 백업과 행 수를 기록한다.
