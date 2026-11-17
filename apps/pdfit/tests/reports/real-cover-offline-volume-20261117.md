# 실제 표지 교체 오류·반영 속도 보고 — 2026-11-17

계획: `apps/pdfit/tests/plans/real-cover-offline-volume-20261117.md`

## 원인 (측정)
- 컨테이너에서 `find /app/data/books` → `Host is down`. 라이브러리 SMB 볼륨이 끊겨 있었다.
- `PUT /api/covers`는 디스크 `statSync`로 파일을 확인해 false → 404 "File not found." 끊긴 마운트의 동기 stat은 서버도 막는다.
- 미리보기에서 받은 이미지를 적용 때 다시 내려받았다.
- 가설 기각: 썸네일·pgvector가 NAS에 있어서 느리다는 가설은 틀렸다. `docker inspect` 마운트: `/app/data`(썸네일 `THUMBNAILS_ROOT=/app/data/thumbnails`, `PGDATA=/app/data/pgvector`)는 `F:\` 로컬 bind, 책(`/app/data/books`)만 `pdfit-usbshare1` SMB 볼륨.

## 수정
- `routes/covers.ts`: 존재 확인을 메타데이터 색인(`hasFile` → `listBooksByFolder`)으로, 색인이 없을 때만 비동기 `stat`.
- `covers/coverImageCache.ts`(신규): 후보 이미지 캐시, 재다운로드 제거.

## 결과
- `node --test packages/pdfit/tests/real-covers.test.mjs`: 8건 통과(신규 1건 포함).
- 배포(`npm run deploy:standalone`) 후 실서버, NAS 끊김 상태: `preview 200 0.044s`, `PUT 200 0.141s`, `DELETE 200`(테스트 적용은 원복).
- 브라우저 UI 검증은 하지 않았다(변경은 서버 API만).
