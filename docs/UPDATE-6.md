# Update 6 — Independent work packages, faithful import/export, price-source hierarchy

Findings come from the user's real project in the app (a contractor quotation workbook with ~30 sheets, one sheet per building). Never commit real client files (data/private/ is gitignored); build synthetic fixtures. Vietnamese UI with diacritics. Keep all existing tests green (309). Backup the DB before any migration or restart. Work and commit in this order: Section 1 (A+B) → Section 2 (C+D) → Section 3 (E). Push after each.

## Problems observed (must all be fixed)
1. The dialog "Nhập dữ liệu" lets the user pick only ONE sheet; "Nhập nhiều sheet" pours every sheet into the SAME estimate. The user requires: **each sheet = one independent "hạng mục công trình"** (CT01 nhà xưởng, CT02, A1 văn phòng, bể PCCC, nhà bảo vệ, đường nội bộ, 01-Điện trung thế…). Items of one must never be mixed into another.
2. Quantity-breakdown rows ("CT1(1 tim)", "CT2(2 tim)", "DK1") were imported as numbered work items with status "cần xem lại · Chưa có đơn giá · Thiếu đơn vị". Sub-labels ("DM1", "TRỤC 1,9(8.4+11.6)", "NHÀ MÁY BƠM") became empty top-level sections.
3. A composite unit price (only "Tổng cộng" = 25.000 in the file) is displayed as VL 12.500 + NC 12.500 and the row is flagged "Thành tiền theo file 52.981.250 khác KL×đơn giá 105.962.500" — the price was split and then counted twice. Some rows show nonsense prices (44; 4; 22) — dimensions read as prices.
4. **Excel export writes 0 for every unit price and amount** although the grid shows file prices; the "Diễn giải khối lượng" column is empty; breakdown rows are numbered like items.
5. Cost summary adds TT36 general cost / pre-determined taxable income on top of contractor all-in prices: direct 252,72 tỷ → "Chi phí xây dựng" 313,38 tỷ. Wrong for a quotation.
6. All 223 items have no norm code; suggestions are weak (12–55%).

## Section 1

### A. Work packages ("Hạng mục công trình")
- New level: Dự án → **Hạng mục công trình** (work package) → Phần (I, II… existing "categories") → Công tác (+ diễn giải lines).
- Table `work_packages`: project_id, code, name, name_zh, order, building_type (overrides project default), area_m2 (optional), mode (see E.4), source_file, source_sheet, note. `categories.work_package_id` NOT NULL after migration. Take-off elements, stories, manual sheets and rebar schedules (Update 5) also get work_package_id.
- Migration: every existing project gets one package "Hạng mục chung" holding all its current categories. No data loss; idempotent; tested.
- UI: a package list on the left of the project page (name, total, item count, status). Selecting a package shows ITS OWN grid (STT restarts), take-off tab, material analysis and cost summary. Actions: thêm, đổi tên, sắp xếp, sao chép, xóa (confirm, undoable revision). Moving a Phần to another package only through an explicit "Chuyển sang hạng mục…" action.
- New project tab "Tổng hợp dự án": one row per package (STT, tên, diện tích, giá trị, đơn giá/m², ghi chú) + project-level lines the user defines (e.g. "Chi phí quản lý 3%", "VAT 8%") + grand total; reconciliation column versus the source workbook's TONGHOP sheet when available.
- All existing features (regional update, price books, assistant tools, revisions, validation tab) work per package and per project.

### B. One import flow
- Replace the two buttons by a single "⤓ Nhập từ Excel" (keep Google Drive source). ONE code path with all Update 4 logic (hidden sheets, multi-block sheets, per-cell VNI, Chinese split, lump sums, nested subtotals, fidelity to file amounts).
- Step 1 — sheet table with a checkbox per sheet (nothing pre-ticked except obvious estimate sheets when the user presses "Chọn tất cả sheet dự toán"): tên sheet · loại nhận diện (editable: Hạng mục công trình / Tổng hợp / Bảng phụ – thống kê thép, khối lượng, tính toán / Bộ giá / Bỏ qua) · số công tác · tổng tiền theo file · **đích**: "Tạo hạng mục công trình mới" with an editable name (default: the sheet's "Hạng mục: …" title line, else the sheet name; keep the Chinese part as name_zh) or "Thay thế hạng mục: X" or "Thêm vào hạng mục: X" (explicit choice only).
- A sheet → exactly one package. Repeated-header blocks inside a sheet → Phần/sub-sections of THAT package (option per sheet: "tách mỗi bảng con thành hạng mục riêng").
- "Tổng hợp" sheets are never imported as items: used to build "Tổng hợp dự án" (match rows to packages by name/total) and for reconciliation. "Bảng phụ" sheets are kept as attachable sources for diễn giải, not as items.
- Step 2 — per-package preview (first 15 rows as they will appear, row types editable, column mapping editable per sheet with "áp dụng cho các sheet cùng mẫu"), reconciliation ✓/⚠ per block and per sheet. Step 3 — apply as ONE undoable revision.
- Re-import of the same workbook: propose "Thay thế" for packages whose source_sheet matches.

## Section 2

### C. Row recognition (synthetic fixture `packages/server/test/fixtures/import_sinomag_like.xlsx` + expected JSON, generated by a committed script)
Fixture: sheets "TONGHOP 总", "CT01_厂房 (test)", "CT02_厂房 (test)", "A1. VP (test)", "01-Điện trung thế", auxiliary "thong ke thep", one hidden sheet. Building-sheet columns: STT | Công việc 内容 (some VNI) | 内容 | ĐVT | Dài | Rộng | Cao | Số cấu kiện | Khối lượng | Đơn giá: Vật liệu / Nhân công / Tổng cộng | Thành tiền.
1. Rows with no STT, no unit and no price under an item — with or without dimensions, e.g. "CT1(1 tim)" qty 14, "CT2(2 tim)" qty 72 — are **diễn giải lines of the item above**, never items. A centred label alone on a row ("DK1", "DM1", "TRỤC 1,9(8.4+11.6)") is a sub-label: it prefixes the following breakdown lines; it is neither an item nor a section.
2. A row is a Phần (section) only with a roman/letter STT (I, II, A…) or an explicit heading with its own subtotal; otherwise not.
3. Unit prices are read ONLY on item rows. Dimension columns are never read as prices (no more 44 / 4 / 22).
4. Composite price: file has only "Tổng cộng" (VL and NC empty) → store `price_composite`, show it in a "Tổng hợp" price column, VL/NC stay empty; amount check uses it once. When VL, NC and Tổng are all present → applied = VL + NC (+ M); Tổng is validation only and never added on top.
5. Cells with Excel errors (#REF!, #NAME?, broken external links) → value missing + flag "lỗi ô nguồn", listed in an import report; never silently 0.
6. Expected JSON asserts: item count per package, breakdown-line count per item, no item named like a breakdown row, composite prices preserved, each package total = its sheet total, project total = TONGHOP.

### D. Excel export
1. Export exactly what the grid applies. Columns: STT | Mã hiệu | Tên công tác | Đơn vị | Diễn giải khối lượng | Khối lượng | Đơn giá (Vật liệu, Nhân công, Máy, Tổng hợp) | Thành tiền (Vật liệu, Nhân công, Máy, Tổng) | Nguồn giá | Ghi chú.
2. Breakdown lines: un-numbered, indented under their item, with their dims/formula text in "Diễn giải khối lượng" and their partial quantity; item STT is continuous inside each Phần.
3. One worksheet per work package (sheet name = package code/name, ≤31 chars, unique) + first sheet "TỔNG HỢP" (packages, project-level lines, grand total). Optional bilingual Việt–Trung names when name_zh exists.
4. Live formulas with cached values: Thành tiền = KL × đơn giá (except rows locked to the file amount: write the value and a note), section and package subtotals = SUM, TỔNG HỢP links to package sheets.
5. Tests: exported totals == grid totals for the fixture; no zero price where the grid has one; round trip export → import → identical package totals; Playwright check that the download works.

## Section 3

### E. Price sources (user rule)
1. Each item has `price_source` with provenance: `dia_phuong` (unit price / price publication issued by the province for the project's region and period), `ho_so` (price from the imported file), `chiet_tinh` (built from the norm of the item's code), `thu_cong` (typed by the user).
2. Project setting "Thứ tự ưu tiên nguồn giá", default: dia_phuong → ho_so → chiet_tinh. Resolver picks the first available source per item; per-item override; bulk "Áp dụng lại thứ tự ưu tiên" with preview (old → new price, source) as an undoable revision. Never mix silently: grid column "Nguồn giá", filter, and a summary (count and value per source) in the "Kiểm tra" tab and in the export.
3. `dia_phuong` is available only when a VERIFIED price book / unit-price set for the project's province and period exists and covers the item (by code, or by resource for chiết tính). If not → fall through. Do not invent prices.
4. `chiet_tinh` — "Phiếu chiết tính đơn giá" per item (needs a norm code): norm resources (VL / NC / M hao phí) × resource prices, resource prices resolved by the same priority (địa phương → derived from the file/manual). The sheet carries a detailed specification: cấu tạo, công nghệ – biện pháp thi công, vật tư chính (quy cách, mác, xuất xứ), ghi chú; the spec text is also an input to code suggestion. Missing resource prices → listed, item flagged "thiếu giá vật tư" (never 0 without a flag). Printable/exportable sheet.
5. Mode per work package: `bao_gia` (contractor quotation — all-in unit prices; package total = Σ thành tiền; NO TT36 chi phí chung / thu nhập chịu thuế tính trước / etc. on top; only the project-level lines of "Tổng hợp dự án") and `du_toan_tt36` (current TT36 summary). Default `bao_gia` for packages imported with file prices, `du_toan_tt36` for new empty packages; clear badge in the header; switching mode shows a before/after preview.
6. Tests: resolver order and override; fall-through when no local price book; chiết tính with a missing resource; bao_gia total equals Σ amounts (no TT36 add-ons); mode switch preview.

## General
- README (Vietnamese): "Hạng mục công trình", "Nhập từ Excel", "Nguồn đơn giá & phiếu chiết tính", "Chế độ báo giá / dự toán TT36". DECISIONS entries.
- npm test, npm run build, e2e for the import → package → export path; restart port 3000 with the normal DB (backup first; run the migration on a copy first and verify item counts/totals are unchanged); commit and push after each section. Never stage data/private.
