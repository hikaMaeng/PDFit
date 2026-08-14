# Test Plan: pdfgpu-display-progress-interpolation

## Goal

Show a full viewer loading gauge when PDFGPU's source progress reaches 35%,
without changing PDFGPU loading or ready-state semantics.

## Steps

1. Run the PDFit/PDFGPU integration tests for the pure display projection.
2. Assert source values 0, 12, 35, and values above 35 map to 0, 34, 100, and
   100 respectively.
3. Build and deploy the viewer, then capture the display gauge during a real
   document opening sequence.

## Pass criteria

The gauge is a clamped linear interpolation with 35 as its 100% endpoint, and
the service continues to become ready normally.
