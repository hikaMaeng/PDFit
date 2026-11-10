# Background task scheduler and server thumbnails — test plan (2026-11-10)

## Goal

Move cover rendering from the browser to a server-side batch, built on a general
periodic task layer that later jobs can reuse.

## Requirement (owner's words, 2026-11-10)

> 관리중인 파일 중에 썸네일 생성이 안된 파일이 있다면 만드는 스케줄이 걸려있는거지.
> 이 작업은 한시간에 한번 정도로 작동되며 썸네일이 파일 수정일자와 다르거나 없는 경우
> 재생성하는 스케줄로 소비할 병렬 프로세스의 수를 미리 정해두며 예약된 작업이 순차적으로
> 서버의 저부하 수준으로 수행되다가 다음 시간대의 스케줄러를 만나면 작업 큐를 다시 비우고
> 재계산하여 큐를 채워서 진행되는 방식으로 간다.

> 한시간 스케줄러는 이후에도 많은 추가적인 정기업데이트 작업을 할 수 있기 때문에 범용적인
> task정의와 task큐 운영 및 병렬성을 잘 고려한다

> 웹워커 병렬을 기본으로 하되 엔벨롭수준으로는 태스크가 일정한 시그니처 구조를 갖고 그
> 내부를 개별 태스크로 정의하는 스크립트로 바라볼 수 있다. 즉 표준 태스크 인터페이스를
> 준수하는 썸네일 제작 웹워커를 만들어서 표준 큐에 넣었다고 볼 수 있겠지

> 이게 무료버전에만 반영되는게 아니라 유료버전도 반영되어야하는데 이러면 스케줄러와 큐
> 시스템이 packages에 있어야할거야

## Criteria and where each is checked

| # | Criterion | Check |
| --- | --- | --- |
| 1 | Hourly schedule | `test:tasks` timer test; deployed `/api/tasks/status` `intervalMs` and `nextPlanAt` |
| 2 | Missing thumbnail, or one that does not match the file's modification time, is (re)generated | `test:tasks` thumbnail job test: fresh skipped, modified re-rendered, old file removed |
| 3 | Parallelism fixed in advance | `test:tasks` scheduler and pool tests; deployed `concurrency`, observed `active` |
| 4 | Next schedule empties the queue and refills it from a recomputation | `test:tasks` replan test (pending dropped, running kept, new plan queued); deployed restart resumes from files on disk |
| 5 | General task definition, queue, and parallelism for future jobs | `test:tasks` runs a second, unrelated task script (`fixtures/sample-task.mjs`) through the same queue, pool, and scheduler |
| 6 | Worker-thread parallelism with a standard envelope and per-task script | `test:tasks` pool test: scripts run off the main thread, on distinct threads; contract violation is reported |
| 7 | Covers are no longer rendered in the browser | Deployed browser check: no PDF canvas, zero PDF downloads, covers are 360 px server JPEGs |
| 9 | Scheduler and queue live in `packages` and are usable by the hosted edition | `test:tasks` hosted-style test: a job registered through `createPdfitTaskScheduler` renders with the shared script over authenticated HTTP range reads. The hosted edition's own job is not part of this change |
| 8 | Existing table data is preserved | Per-table row counts before and after deploy; `pg_dump` backup before deploy |

## Steps

1. `npm run test:tasks`.
2. `npm run build`, `npm run test:service` (shared code changed), `npm run verify:repo`.
3. Record row counts and `pg_dump` the standalone database.
4. `npm run deploy:standalone`; health, restart count, row counts.
5. Read `/api/tasks/status` after the first plan; note CPU and memory.
6. `apps/pdfit/tests/free-cover-view-deployed-browser.mjs` while the backlog is large
   (with `PDFIT_SCROLL_CARD_INDEX`), then again after the queue drains
   (`PDFIT_WAIT_TASKS_IDLE_SECONDS`).
7. Count thumbnail files in the container and compare with the library.

## Not in scope

- The hosted service's own thumbnail job (per-account plan, storage, and route). The
  shared layer it needs is in place and tested; the service does not register a job yet.
- Waiting a full hour for the second scheduled run on the deployed server; the timer
  is covered by the unit test with a short interval.
