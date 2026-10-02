# Update 5 — Element-based quantity take-off ("Bóc khối lượng theo cấu kiện")

Goal (user request): upgrade DUTOAN-AI in the direction of element-based take-off tools: the user declares structural/architectural elements, the software generates the work items and quantities from formulas and pushes them into the estimate. **Manual calculation must always be possible** (type a formula or dimensions and get a quantity directly). ETABS connection is a **fallback / later phase** — only prepare the interface now.

Original design and code only. Do not copy any third-party software. All labels in Vietnamese with diacritics. Reuse the existing safe quantity-expression parser, revisions/undo, norm dataset TT38_2026 and suggestion engine.

## A. Data model (server + core)

1. `stories` (tầng): project_id, name ("Móng", "Trệt", "Tầng 1"…), height_m, elevation_m, order.
2. `takeoff_elements`: project_id, category_id (hạng mục), story_id, type, name ("M1", "C1", "D1-01"), count (số cấu kiện), params (JSON, SI units: m), material (mác bê tông, loại gạch…), note, source (`manual` | `excel` | `etabs`), source_ref.
3. `takeoff_task_templates` (per element type, seeded defaults, editable per project): key, tên công tác, đơn vị, formula (expression over element params), condition (expression, optional), norm rule (how to pick the TT38 code, see C), enabled.
4. `takeoff_quantities`: element_id, template_key, formula_text, computed_value, override_value (nullable), override_reason; value used = override ?? computed.
5. `manual_sheets` (bảng tính tay): free rows not tied to an element: diễn giải, either `expression` ("2*(3,5+4,2)*0,2*3") or dims (dài, rộng, cao, số cấu kiện, hệ số), result, target work item. Accept both "," and "." decimals.
6. `rebar_schedule` (bảng thống kê cốt thép): element_id (or free text cấu kiện), số hiệu, shape code (dạng), L1..L6 (mm), Ø (mm), chiều dài 1 thanh (mm, computed from shape unless typed), số cấu kiện, số thanh / 1 cấu kiện, tổng chiều dài (m), trọng lượng (kg).
7. Link table estimate_item ↔ takeoff sources so every quantity line in the estimate is traceable to its elements (diễn giải khối lượng lines are generated from them).

## B. Element types, parameters and default formulas

All formulas are per element × `count`. Every parameter has a sane default and is shown in the form with a small sketch/hint. Users can edit formulas in the template editor.

| Type | Parameters | Default generated tasks (unit: formula) |
|---|---|---|
| Móng đơn | a, b, h, lót dày t_l (0,1), mở rộng lót e_l (0,1), sâu đào H_d, mở rộng thi công e_tc (0,3), hệ số mái dốc m (0), cổ móng (bc, hc, Hc) | Bê tông móng m³: a·b·h (+ cổ: bc·hc·Hc as its own task) · Bê tông lót m³: (a+2e_l)(b+2e_l)·t_l · Ván khuôn móng m²: 2(a+b)·h · Đào móng m³: hố đáy A=(a+2e_l+2e_tc), B=(b+2e_l+2e_tc); m=0 → A·B·H_d; m>0 → H_d/6·[A·B+(A+A')(B+B')+A'·B'] with A'=A+2mH_d, B'=B+2mH_d · Đắp đất m³: đào − (BT móng + BT lót + phần cổ móng ngầm) · Cốt thép: from rebar schedule or hàm lượng kg/m³ |
| Móng băng | b, h, L, sườn (bs, hs), lót, đào params | BT móng: b·h·L (+ sườn bs·hs·L) · lót: (b+2e_l)·t_l·L · VK: 2·h·L (+2·hs·L) · đào/đắp as above with length L |
| Đài cọc / móng cọc | a, b, h, số cọc n, D cọc, L cọc, đoạn đập đầu cọc, lót, đào params | Ép/đóng cọc m: n·L · Đập đầu cọc: cái (n) and m³ (π·D²/4·đoạn đập or a² for cọc vuông) · BT đài, lót, VK, đào, đắp as móng đơn |
| Giằng móng / đà kiềng, Tường móng | b, h, L | BT: b·h·L · VK: 2·h·L · lót (optional) |
| Cột | b, h (or D tròn), H tầng, h dầm (deduct), rule `cot_den_day_dam` (default true) | BT cột m³: b·h·(H − h_dầm) (rule on) or b·h·H · VK cột m²: 2(b+h)·(H − h_dầm); tròn: π·D·H · Tô/trát cột (optional) |
| Dầm | b, h, L thông thủy, h sàn | BT dầm m³: b·h·L · VK dầm m²: (b + 2·(h − h_sàn))·L |
| Sàn | diện tích S (or a×b), dày t, lỗ mở S_lo | BT sàn m³: (S − S_lo)·t · VK sàn m²: S − S_lo |
| Vách BTCT | L, t, H, lỗ mở | BT: (L·H − S_lo)·t · VK: 2·(L·H − S_lo) |
| Cầu thang (bản) | bề rộng, chiều dài nghiêng, dày, chiếu nghỉ S | BT, VK đáy; bậc xây optional |
| Tường xây | L, H, dày, lỗ cửa S_cua, loại gạch, mác vữa | Xây tường m³: (L·H − S_cua)·dày (also show m²) · Trát 2 mặt m²: 2·(L·H − S_cua) · Bả, sơn m² (optional, in/out) · Ốp chân tường m (optional) |
| Lanh tô | b, h, L | BT, VK: (b+2h)·L, cốt thép |
| Nền | S, lớp: bê tông dày, lót, đá 4x6/0x4 dày, nilon | BT nền m³, lót m³, đá m³, nilon m² |
| Hoàn thiện (tự do) | S or L | Lát, ốp, trần, sơn — quantity = S (or L) × count |

Deduction priority at intersections is a project setting (default: Cột > Dầm > Sàn — cột chạy suốt đến đáy dầm, dầm tính cả phần trong sàn, sàn nhập diện tích thông thủy). Keep it simple and explicit: the app never deducts silently; every deduction is a visible parameter.

## C. Norm codes for generated tasks
- Never hard-code or invent norm codes. Resolve each task against the project's active norm set (TT38_2026, PL2 new construction) with the existing suggestion engine using: work name + element type + parameters that TT38 tables depend on (e.g. tiết diện cột ≤0,1 m² / >0,1 m², chiều cao ≤6 m / ≤28 m…, đường kính cốt thép group, mác bê tông, chiều rộng móng ≤250 cm / >250 cm, loại ván khuôn, chiều dày tường ≤33 cm, cấp đất).
- Missing parameters (cấp đất, phương pháp thi công thủ công/máy, bê tông thương phẩm hay trộn tại chỗ, loại ván khuôn) are asked once per project in a "Thiết lập bóc khối lượng" panel and stored.
- Show top-3 candidates with confidence; unresolved → status "chưa có mã", never block quantities.

## D. Rebar
1. Two modes per element: (a) quick: hàm lượng thép kg/m³ bê tông (user value, with typical hints left EMPTY by default — do not invent ratios), (b) detailed: bảng thống kê cốt thép.
2. Unit weight table (kg/m): Ø6 0,222; Ø8 0,395; Ø10 0,617; Ø12 0,888; Ø14 1,21; Ø16 1,58; Ø18 2,00; Ø20 2,47; Ø22 2,98; Ø25 3,85; Ø28 4,83; Ø32 6,31; other Ø → 0,006165·d². Editable.
3. Summary per element type by diameter and by the three norm groups: Ø≤10, 10<Ø≤18, Ø>18 (tấn) → one estimate item per (element type, group) mapped to the matching TT38 "Cốt thép …" code family.
4. Import a rebar schedule from Excel: columns TÊN CẤU KIỆN | SỐ HIỆU | DẠNG | L1..L6 | Ghi chú | Ø (mm) | chiều dài 1 thanh (mm) | SỐ CẤU KIỆN | SỐ THANH 1 cấu kiện | toàn bộ | TỔNG chiều dài (m) | TỔNG trọng lượng (kg) (header on 3 rows). Use the user-driven column mapping from Update 3. Create a synthetic fixture `rebar_schedule_like.xlsx` for tests (made-up data; never commit user files).

## E. Manual calculation (must work without any element)
1. In every estimate item: "Diễn giải khối lượng" grid already exists — add a formula column accepting expressions with Vietnamese decimals, named variables (`a=3,5; b=4,2; 2*(a+b)*0,2`), comments after `//`, and functions: `tron(x,n)`, `pi`, `sqrt`, `min`, `max`, `abs`, `chuvi_cn(a,b)`, `dt_cn(a,b)`, `dt_tron(d)`, `tt_hop(a,b,h)`, `tt_tru(d,h)`, `tt_chop_cut(a,b,a2,b2,h)`.
2. "Bảng tính nhanh" (quick table): Tên bản vẽ | Hạng mục | Số lượng n | Diện tích A (m²) | Chiều dài L (m) | Chiều cao H (m) → Tổng diện tích = A·n, Tổng chiều dài = L·n, Tổng thể tích = A·H·n, Diện tích xung quanh = L·H·n. A row can be sent to any estimate item as a diễn giải line.
3. Any generated quantity can be overridden by hand: the cell shows the computed value struck through next to the manual one, with a "↺ trả về công thức" button. Overrides survive re-generation.

## F. Push to estimate
1. Button "Đẩy sang dự toán" → preview: per work item (name, unit, norm code/status, quantity) with the breakdown lines (element name × count: formula = value), grouped by hạng mục and story; shows adds / updates / unchanged versus the current estimate.
2. Apply = one undoable revision. Items created from take-off are marked "từ bóc khối lượng"; re-push updates their quantities and diễn giải, keeps prices, manual edits and overrides; if the user edited the quantity directly in the estimate, show a conflict row and let them choose.
3. Aggregation: same norm code + same name + same unit → one item with several diễn giải lines (per element), option "tách theo tầng".

## G. UI
- New project tab "Bóc khối lượng": left tree (Tầng → loại cấu kiện), centre grid of elements (keyboard friendly: Enter adds row, copy/paste rows from Excel, duplicate to other stories "Sao chép sang tầng…"), right panel with generated tasks (formula, value, code status) for the selected element.
- Sub-tabs: Cấu kiện | Bảng tính tay | Thống kê thép | Thiết lập (tầng, quy tắc trừ giao, mẫu công tác).
- Excel import of an element list (columns: loại, tên, tầng, số lượng, kích thước…) with the mapping dialog.
- Assistant tools (offline rules + ChatGPT/Claude providers): add elements from a sentence ("thêm 12 cột C1 30x40 cao 3,6 m tầng 1"), explain a quantity, list elements without codes. Write actions go through the existing preview → Áp dụng/Hủy flow.

## H. ETABS — fallback, later phase (do NOT implement the connection now)
- Define an `ElementSource` interface (list stories, frames with section b×h and length, area objects with thickness and area) and a stub provider with a clear "Chưa hỗ trợ trong bản này" message.
- Document two future options in docs/ETABS.md: (1) import of tables the user exports from ETABS to Excel (Story Definitions, Frame Section Definitions, Frame Assignments – Section Properties, Beam/Column connectivity & lengths, Area/Shell assignments); (2) direct API only in the Windows desktop build (Electron) on a machine with ETABS installed. A web app in the browser cannot call the ETABS API.

## I. Acceptance tests (vitest; numbers must match exactly, rounding 3 decimals)
1. Móng đơn M1: a=1,8 b=1,2 h=0,5; lót 0,1, e_l=0,1; H_d=1,5; e_tc=0,3; m=0; count 10 → BT móng 10,8 m³; BT lót 2,8 m³; VK 30 m²; đào 78 m³; đắp 64,4 m³.
2. Same with m=0,5 → đào 141 m³ (14,1 m³ each: 1,5/6·[2,6·2,0+(2,6+4,1)(2,0+3,5)+4,1·3,5]).
3. Cột C1 0,3×0,4; H=3,6; h dầm 0,5; count 8 → BT 2,976 m³; VK 34,72 m².
4. Dầm D1 0,22×0,5; L=4,6; h sàn 0,12; count 6 → BT 3,036 m³; VK 27,048 m².
5. Sàn S=20 m², lỗ 1 m², dày 0,12 → BT 2,28 m³; VK 19 m².
6. Tường xây L=5; H=3,1; dày 0,2; cửa 2,64 m² → 12,86 m²; 2,572 m³; trát 2 mặt 25,72 m².
7. Rebar: Ø16, 6200 mm, 12 thanh/cấu kiện, 8 cấu kiện → 595,2 m; 940,416 kg; group 10<Ø≤18.
8. Quick table: n=4, A=2,5, L=6, H=3 → 10 m²; 24 m; 30 m³; 72 m².
9. Expression `a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao` → 9,24.
10. Push to estimate creates items with traceable diễn giải; re-push after changing M1 count to 12 updates quantities, keeps a manual override and prices; undo restores.
11. Playwright e2e: create element → see tasks → push → item appears in the estimate grid.

## J. General
- Keep all existing tests green; README section "Bóc khối lượng theo cấu kiện" (Vietnamese, with the formulas above); DECISIONS entries.
- npm test, npm run build, restart on port 3000 with the normal DB (backup first, never delete user data), commit and push after sections A–F (server/core), then G (web), then docs. Never stage data/private.
