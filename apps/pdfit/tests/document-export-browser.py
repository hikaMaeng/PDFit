from pathlib import Path
import json
import os
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
OUTPUT = ROOT / "test" / "20260904" / "document-export"
SCREENSHOTS = OUTPUT / "screenshots"
OUTPUT.mkdir(parents=True, exist_ok=True)
SCREENSHOTS.mkdir(parents=True, exist_ok=True)
ORIGIN = os.environ.get("PDFIT_TEST_ORIGIN", "http://127.0.0.1:15211")

PDF_BYTES = b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"


def fulfill_json(route, value):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(value, ensure_ascii=False))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(locale="ko-KR", accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(15000)
    console_errors = []
    page_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    def route_api(route):
        url = route.request.url
        if "/api/auth/me" in url:
            fulfill_json(route, {
                "authenticated": True,
                "user": {"id": "test-user", "email": "test@example.com", "name": "Test User", "picture": None},
                "subscription": {"status": "active", "access": True, "priceKrw": 12000, "trialEndsAt": "2026-09-30T00:00:00.000Z", "currentPeriodEndsAt": "2027-09-30T00:00:00.000Z", "cancelAtPeriodEnd": False, "nextBillingAt": None, "trialDaysRemaining": 0, "earlyPurchaseBonusDays": 0},
            })
        elif "/api/folders/cache" in url:
            fulfill_json(route, {
                "libraryInstanceId": "library-test", "schemaVersion": "1", "hydratedAt": "2026-09-04T06:00:00.000Z",
                "snapshot": {
                    "system": [],
                    "folders": [{"driveFolderId": "folder-1", "parentFolderId": "root", "name": "연구", "color": "#3b82f6", "isRoot": True, "trashed": False, "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z"}],
                    "pdfs": [{"driveFileId": "file-1", "parentFolderId": "folder-1", "name": "인공지능 개론.pdf", "mimeType": "application/pdf", "size": len(PDF_BYTES), "md5Checksum": "", "driveVersion": "1", "createdTime": "2026-09-04T06:00:00.000Z", "modifiedTime": "2026-09-04T06:00:00.000Z", "trashed": False, "updatedAt": "2026-09-04T06:00:00.000Z"}],
                    "tags": [{"tagId": "tag-1", "name": "AI", "color": "#3b82f6", "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z", "deletedAt": ""}, {"tagId": "tag-2", "name": "학습", "color": "#22c55e", "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z", "deletedAt": ""}],
                    "pdf_tags": [{"relationId": "relation-1", "driveFileId": "file-1", "tagId": "tag-1", "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z", "deletedAt": ""}, {"relationId": "relation-2", "driveFileId": "file-1", "tagId": "tag-2", "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z", "deletedAt": ""}],
                    "bookmarks": [{"bookmarkId": "bookmark-1", "driveFileId": "file-1", "pageIndex": 6, "x": 10, "y": 20, "width": 120, "height": 80, "borderColor": "#f59e0b", "fillColor": "", "fillOpacity": 0.2, "memo": "다시 읽기", "imageMimeType": "image/jpeg", "localImageUrl": "", "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z", "deletedAt": ""}],
                    "reading_progress": [{"driveFileId": "file-1", "lastPage": 7, "updatedAt": "2026-09-04T06:00:00.000Z"}],
                    "viewer_state": [{"driveFileId": "file-1", "page": 7, "scale": 1.2, "fitMode": "none", "viewMode": "single", "inverted": False, "uiHidden": False, "scrollTop": 0, "updatedAt": "2026-09-04T06:00:00.000Z"}],
                    "sync_state": [],
                },
            })
        elif "/api/folders/" in url and ("/files/" in url or "/by-id/" in url):
            route.fulfill(status=200, content_type="application/pdf", body=PDF_BYTES)
        elif "/api/viewer-state/" in url:
            fulfill_json(route, {"page": 7, "scale": 1.2, "fitMode": "none", "viewMode": "single", "inverted": False, "uiHidden": False, "scrollTop": 0})
        elif "/api/progress/" in url:
            fulfill_json(route, {"page": 7})
        elif "/api/tags/book/" in url:
            fulfill_json(route, ["AI", "학습"])
        elif "/api/annotations" in url:
            fulfill_json(route, [{
                "id": "annotation-1", "documentId": "/api/folders/연구/files/인공지능 개론.pdf",
                "pageIndex": 6, "type": "text",
                "geometry": {"x": 10, "y": 20, "width": 120, "height": 30, "text": "핵심 개념", "fontSize": 14},
                "style": {"color": "#ef4444", "opacity": 1, "strokeWidth": 2, "fillColor": None},
                "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z",
            }])
        elif "/api/bookmarks/" in url:
            fulfill_json(route, [{
                "id": "bookmark-1", "folder": "연구", "filename": "인공지능 개론.pdf", "pageIndex": 6,
                "rect": {"x": 10, "y": 20, "width": 120, "height": 80}, "borderColor": "#f59e0b",
                "fillColor": None, "fillOpacity": 0.2, "comment": "다시 읽기", "imageMimeType": "image/jpeg",
                "imageUrl": "/api/bookmark-assets/bookmark-1/capture.jpg",
                "createdAt": "2026-09-04T06:00:00.000Z", "updatedAt": "2026-09-04T06:00:00.000Z",
            }])
        elif "/api/bookmark-assets/" in url:
            route.fulfill(status=200, content_type="image/jpeg", body=b"bookmark-image")
        elif "/api/settings/translations" in url:
            fulfill_json(route, {"translations": ["연구"]})
        else:
            fulfill_json(route, {})

    page.route(f"{ORIGIN}/api/**", route_api)
    page.goto(f"{ORIGIN}/viewer/")
    page.wait_for_load_state("networkidle")
    page.evaluate("""() => {
      history.pushState({}, '', '/viewer/%EC%97%B0%EA%B5%AC/%EC%9D%B8%EA%B3%B5%EC%A7%80%EB%8A%A5%20%EA%B0%9C%EB%A1%A0.pdf?engine=legacy');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }""")
    page.wait_for_timeout(1000)
    zoom_input = page.get_by_label("확대/축소 비율")
    zoom_input.fill("137")
    zoom_input.press("Enter")
    assert zoom_input.input_value() == "137"

    continuous_button = page.get_by_role("button", name="연속 스크롤")
    assert continuous_button.get_attribute("aria-pressed") == "false"
    continuous_button.click()
    assert continuous_button.get_attribute("aria-pressed") == "true"
    continuous_button.click()
    assert continuous_button.get_attribute("aria-pressed") == "false"

    fit_width_button = page.get_by_role("button", name="가로 너비 맞춤")
    fit_width_button.click()
    assert fit_width_button.get_attribute("aria-pressed") is None

    select_move_button = page.get_by_role("button", name="select")
    assert select_move_button.locator('[data-testid="select-move-cursor-icon"]').count() == 1
    select_move_button.hover()
    page.get_by_text("선택·이동", exact=True).wait_for(state="visible")

    export_button = page.get_by_test_id("document-export-open")
    export_button.wait_for(state="visible")
    export_button.click()
    page.get_by_role("heading", name="문서 내보내기").wait_for(state="visible")
    assert page.get_by_text("이 PDF 파일을 기기에 다운로드합니다.", exact=True).is_visible()
    assert page.get_by_text("인공지능 개론.pdf", exact=True).is_visible()
    assert page.get_by_text("원본 PDF", exact=True).count() == 0
    assert page.get_by_text("Markdown 독서 노트", exact=True).count() == 0
    assert page.get_by_text("JSON 데이터", exact=True).count() == 0
    page.screenshot(path=str(SCREENSHOTS / "01-export-dialog.png"), full_page=True)

    try:
        with page.expect_download() as pdf_download:
            page.get_by_role("button", name="내보내기", exact=True).click()
    except Exception:
        page.screenshot(path=str(SCREENSHOTS / "export-failure.png"), full_page=True)
        print(page.locator("body").inner_text())
        print(json.dumps({"consoleErrors": console_errors, "pageErrors": page_errors}, ensure_ascii=False))
        raise
    assert pdf_download.value.suggested_filename == "인공지능 개론.pdf"

    assert not console_errors, console_errors
    assert not page_errors, page_errors
    (OUTPUT / "result.json").write_text(json.dumps({
        "dialog": True,
        "toolbar": {"manualZoom": True, "continuousToggle": True, "fitWidthMomentary": True, "cursorTool": True},
        "downloads": [pdf_download.value.suggested_filename],
        "consoleErrors": console_errors,
        "pageErrors": page_errors,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    browser.close()
