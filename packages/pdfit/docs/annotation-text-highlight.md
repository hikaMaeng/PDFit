# Text-based Highlight Extension

PDFit의 현재 annotation layer는 PDFGPU가 제공하는 page overlay projection을 이용해 PDF page 좌표와 SVG 좌표를 변환한다. 영역 기반 highlight는 이 계약만으로 구현할 수 있다.

텍스트 선택 기반 highlight에는 글자별 content, glyph bounds, reading order를 같은 page 좌표계로 제공하는 text layer 또는 공개 extraction API가 필요하다. 현재 PDFGPU viewer 통합에는 이 계약이 없으며, Canvas/WebGPU 결과에서 픽셀을 역추적하는 방식은 사용하지 않는다.

향후 PDFGPU가 page별 text run과 bounds를 공개하면 다음 순서로 확장한다.

1. PDFGPU text run을 투명 HTML/SVG selection layer로 투영한다.
2. 브라우저 selection range를 PDF page 좌표의 여러 rectangle로 정규화한다.
3. 하나의 logical highlight와 여러 geometry rectangle를 저장하도록 protocol을 확장한다.
4. 현재 SVG annotation layer가 저장된 rectangle들을 합성한다.

이 확장은 PDF 렌더러를 교체하거나 원본 PDF를 수정하지 않는다.
