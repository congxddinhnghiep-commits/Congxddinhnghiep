# Update 3 — user-driven Excel import mapping + regional norm/price update button

Fixture from the user: `packages/server/test/fixtures/test_import.xlsx` (sheet DUTOAN). Structure:
- Title row 1, header on rows 3–4 (NO merged cells): A STT, B Mã hiệu, C "Hạng mục công việc 工作项目", D ĐVT, E Khối lượng, F3 "Đơn giá 单价" spanning F–G with F4 "Vật liệu", G4 "Nhân công", H Thành tiền, I Ghi chú.
- Row 5: category "A | PHẦN MÓNG". Rows 6–8 work items. Row 9 "Cộng phần móng" = SUM (subtotal, must be excluded).
- Thành tiền cells are formulas `=E6*(F6+G6)` WITHOUT cached values (file saved by a library) → current importer loses them.
- Row 6 code AB.11213, row 7 code AF.11111 (old TT12-era style; TT38/2026 uses AF.11110/AF.11120 for bê tông lót móng), row 8 has NO code ("Cốt thép móng D<=10", tấn).

## A. Import mapping — the user chooses every column
1. After upload and sheet selection, show a mapping panel with one row per target field:
   Mã hiệu · Hạng mục công việc (tên công tác) · Đơn vị · Khối lượng · Diễn giải khối lượng · Đơn giá vật liệu · Đơn giá nhân công · Đơn giá máy · Đơn giá tổng hợp · Thành tiền · Ghi chú · STT/phân cấp.
   Each field: a checkbox "Lấy cột này" + a dropdown listing EVERY non-empty column as `F – Đơn giá 单价 / Vật liệu (vd: 15.000; 1.150.000…)` (column letter + combined header text of all header rows + 3 sample values). Auto-detection only pre-fills; the user can change or clear any field. Allow "Không lấy".
2. Let the user set/adjust the header rows (e.g. 3–4) and the data range (first/last row); detect 2-row headers even without merged cells (a header cell whose right neighbour is empty and whose row below has sub-labels spans those columns → "Đơn giá / Vật liệu", "Đơn giá / Nhân công").
3. Row type column in the preview with an editable badge per row: Hạng mục (category) / Công việc / Dòng cộng (bỏ qua) / Ghi chú (bỏ qua). Auto rules: roman/letter STT + no quantity → category; text starting "Cộng", "Tổng", "小计", "合计" or a SUM formula → subtotal; the user can override any row.
4. Pricing option (radio): (a) "Giữ nguyên đơn giá trong file" (default) — the imported VL/NC/M unit prices are stored as item-level manual prices with source "file Excel <name>, ô F6"; (b) "Tính lại theo định mức & bộ giá của công trình".
5. Formulas without cached values: evaluate them (at least + − × ÷, parentheses, SUM over ranges, references in the same sheet) using the imported numbers; if a formula cannot be evaluated flag it, never import 0 silently.
6. Fidelity check before commit: a reconciliation table — per row: KL, đơn giá, thành tiền trong file vs thành tiền tính lại; category subtotals and grand total vs the file's "Cộng/Tổng" rows. Show ✔/⚠ and the difference. For the fixture the expected values are: 1.187.500; 4.384.000; 15.555.000; subtotal 21.126.500 (all must match with option (a)).
7. After import the estimate grid must mirror the file: same order, category "PHẦN MÓNG", 3 items, same names/units/quantities/prices, notes ("x" on row 6). Keep raw source (file/sheet/row/cell) on every item.

## B. Norm code mapping for imported items ("mã hiệu cập nhật theo hạng mục")
For each imported item, keep `norm_code_raw` and resolve `norm_code` against the project's active norm set (TT38_2026):
1. Exact code exists → use it, BUT compare the file description with the TT38 name of that code; if they disagree (low similarity or conflicting parameters) keep the code and set status "mã và tên công việc không khớp – cần kiểm tra", showing the TT38 name next to the file name plus suggestions. Example in the fixture: AB.11213 in TT38 is "Đào xúc đất (để đắp hoặc ra bãi thải) – cấp đất III", while the file says "Đào đất móng bằng thủ công" → flag it and suggest the đào móng codes (AB.113xx/AB.114xx family, pick by width/depth/soil class, asking the user for missing parameters).
1b. Exact code exists and description agrees → status "khớp mã".
2. Code missing from the active set but looks like a norm code (old TT12/TT10-era, e.g. AF.11111) → find candidates by: same prefix family (AF.111xx), description + unit similarity, parameters (M100, đá 4x6, D<=10, cấp đất III…) → propose the best TT38 code with confidence and reason; status "đề xuất chuyển mã" (needs confirmation). Never overwrite the raw code.
3. No code → run the suggestion engine on description + unit (e.g. "Cốt thép móng D<=10", tấn → AF.61110 Cốt thép móng Ø≤10).
4. Show a column "Mã đề xuất" with top-3 dropdown + confidence; buttons "Chấp nhận tất cả ≥ ngưỡng" and per-row accept/choose. Accepted codes attach the TT38 resource analysis; with pricing option (a) the file prices remain the applied price and the norm-based price is shown alongside as "giá theo định mức" for comparison.
5. Tests with the fixture: row 6 AB.11213 → code kept, mismatch flag raised, đào móng suggestions offered; row 7 AF.11111 → proposal AF.11110 (bê tông lót móng, chiều rộng ≤250 cm) with reason; row 8 → AF.61110.

## C. Button "Cập nhật định mức & đơn giá theo khu vực"
1. In the project toolbar and the Assistant: opens a dialog with selections:
   - Tỉnh/thành (34 units) + khu vực (if the price book has sub-areas), Kỳ giá (month/quarter), Loại giá to update (vật liệu / nhân công / ca máy — checkboxes), Bộ định mức (TT38_2026 default; show dataset status).
   - Option "Tự động chọn bộ giá mới nhất ≤ ngày lập giá" (default on).
2. Preview: list of affected resources and items with old price → new price, source (document number/date), items without any price in the selected books (stay on current price, flagged), and the total change of GXDTT/GXD.
3. Apply = new estimate revision (audit log), undoable; never modifies approved revisions.
4. "Tự động cập nhật": a project setting; when a newer verified price book for the project's region is imported, show a notification badge "Có bộ giá mới – Cập nhật?" (do not apply silently).
5. Same flow to switch norm set (e.g. from sample to TT38_2026): re-map codes as in section B and show the preview before applying.

## D. General
- Vietnamese UI labels; keep existing tests passing; add tests for sections A–C (including the fixture and the 3 expected totals).
- Update README (hướng dẫn nhập Excel & cập nhật theo khu vực), DECISIONS.
- npm test, npm run build, restart on port 3000 with the normal DB (do not delete user data), commit and push.
