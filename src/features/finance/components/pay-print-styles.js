/**
 * The pay printouts' own document (see PrintPortal in PaySummaryPrint.jsx): the printout is laid out
 * in a hidden iframe, never in the app's page, so these styles apply only there.
 *
 * Font: the app itself loads no Hebrew web font (Tailwind's "Nunito" is not loaded; the screen uses
 * system fonts), so the printout uses installed fonts that have Hebrew: Arial (Windows, macOS, iOS),
 * then Segoe UI and Tahoma (Windows), then Noto Sans Hebrew (Android, ChromeOS, Linux). Installed
 * fonts are embedded in "Save as PDF" as real fonts with selectable text; a downloaded web font
 * (Google's Noto Sans Hebrew) came out as Type3 glyph drawings, so none is loaded.
 *
 * No `filter`, `opacity`, `transform`, `mix-blend-mode` or shadows: Chrome draws a page with a
 * filter as one picture, with no text in the PDF.
 */
const FONT_STACK = 'Arial, "Segoe UI", Tahoma, "Noto Sans Hebrew", sans-serif';

export const PAY_PRINT_CSS = `
@page {
  size: A4 portrait;
  /* The bottom margin holds the page number, in a margin box (recent Chrome), so it never covers
     the table. Nothing is position: fixed: a fixed element repeats on every page over the content. */
  margin: 14mm 14mm 20mm;
  @bottom-center { content: "עמוד " counter(page) " מתוך " counter(pages); font: 9pt ${FONT_STACK}; color: #666; }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  direction: rtl; color: #1a1a1a; font: 10.5pt/1.5 ${FONT_STACK};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.pay-print-page { break-after: page; }
.pay-print-page:last-of-type { break-after: auto; }
/* Laid out like TutTiud's exports: the titles on the start side, the logos on the end side (the
   system's logo, then the organisation's when it has one), a coloured rule under them. */
.pay-print-header {
  display: flex; justify-content: space-between; align-items: center; gap: 6mm;
  margin-bottom: 7mm; padding-bottom: 4mm; border-bottom: 0.8mm solid #4f46e5;
}
.pay-print-heading { min-width: 0; }
.pay-print-org { font-size: 10pt; color: #666; }
.pay-print-header h1 { font-size: 17pt; font-weight: 700; margin: 0; line-height: 1.3; }
.pay-print-header h2 { font-size: 13pt; font-weight: 700; margin: 1mm 0 0; color: #4f46e5; }
.pay-print-date { font-size: 9.5pt; color: #666; margin-top: 1mm; }
.pay-print-logos { display: flex; align-items: center; gap: 5mm; flex-shrink: 0; }
.pay-print-logo { height: 13mm; width: auto; max-width: 35mm; object-fit: contain; }
.pay-print-table { width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; }
.pay-print-table thead { display: table-header-group; }
.pay-print-table tr { break-inside: avoid; }
.pay-print-table th {
  background: #eef0fb; color: #3730a3; font-size: 9.5pt; font-weight: 700;
  padding: 1.8mm 3mm; border-bottom: 1px solid #c7cbe8; text-align: start;
}
.pay-print-table td { padding: 1.5mm 3mm; vertical-align: top; border-top: 1px solid #e5e7eb; text-align: start; }
.pay-print-table th:last-child, .pay-print-table td:last-child {
  text-align: left; white-space: nowrap; font-variant-numeric: tabular-nums; width: 32mm;
}
.pay-print-main td { background: #f3f4f6; border-top: 1px solid #9ca3af; font-weight: 700; }
.pay-print-table-flat .pay-print-main td { background: transparent; border-top: 1px solid #e5e7eb; font-weight: 600; }
.pay-print-table-flat .pay-print-main:nth-child(even) td { background: #f9fafb; }
.pay-print-sub td:first-child { padding-inline-start: 8mm; }
.pay-print-note td { font-size: 8.5pt; color: #6b7280; padding-block: 0.8mm; border-top: 0; }
.pay-print-table .pay-print-note td:last-child { text-align: start; white-space: normal; width: auto; padding-inline-start: 8mm; font-variant-numeric: normal; }
.pay-print-sub2 td { font-size: 9.5pt; color: #333; }
.pay-print-sub2 td:first-child { padding-inline-start: 14mm; }
.pay-print-total td {
  border-top: 0.6mm solid #1a1a1a; border-bottom: 0.6mm solid #1a1a1a;
  font-weight: 700; font-size: 12.5pt; padding-block: 2.5mm;
}
/* A lesson nobody marked: an icon and the words, in amber, where the lesson is listed. */
.pay-print-flag {
  display: inline-flex; align-items: center; gap: 1mm; margin-inline-start: 2mm;
  padding: 0 1.5mm; border: 0.3mm solid #d97706; border-radius: 1.5mm;
  color: #92400e; background: #fffbeb; font-size: 8.5pt; font-weight: 700; white-space: nowrap;
  vertical-align: baseline;
}
.pay-print-flag svg { width: 3mm; height: 3mm; }
/* "חסר" is told apart by its words and its double border, not by colour alone. */
.pay-print-exception td { font-weight: 700; }
.pay-print-exception-danger td { background: #fef2f2; color: #991b1b; border-top: 1.2mm double #991b1b; }
`;
