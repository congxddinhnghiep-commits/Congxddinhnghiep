# DUTOAN-AI – Phần mềm lập dự toán xây dựng

Phần mềm lập dự toán công trình xây dựng tại Việt Nam (chức năng lõi tương tự Dự toán F1/G8), chạy được **trên web**
(đăng nhập từ trình duyệt bất kỳ) và **trên máy tính cá nhân** (cùng một mã nguồn), kèm **trợ lý AI** nhận lệnh tiếng Việt.

> ⚠ Định mức và giá tài nguyên kèm theo là **DỮ LIỆU MẪU** (không lấy từ TT 38/2026 hay công bố giá nào). Hãy nạp định mức chính thức
> (phụ lục TT 38/2026 thay thế theo CV 9947/BXD-VPB) và công bố giá địa phương qua chức năng Nhập dữ liệu / Bộ đơn giá.
> Bảng tỷ lệ TT 36/2026 (Bảng 3.3–3.7) đã được đối chiếu và đánh dấu **đã xác minh**; quản trị viên có thể chuyển về TẠM tại **Căn cứ pháp lý**.

## Căn cứ pháp lý (cập nhật 27/09/2026)
Mỗi công trình lưu một **bộ căn cứ pháp lý** và không bao giờ bị tự động đổi:

| Bộ pháp lý | Áp dụng | Phương pháp | Định mức |
|---|---|---|---|
| **TT 36/2026 + TT 38/2026** (hiện hành) | Ngày lập giá từ 01/07/2026 (mặc định) | Bảng 3.8 TT 36/2026 (đính chính QĐ 1538/QĐ-BXD) | Bộ `TT38_2026`, nhân công theo **nhóm** |
| **TT 11/2021 + TT 12/2021** (lịch sử) | Ngày lập giá trước 01/07/2026 | Phương pháp Phase 1 | Bộ `TT12_2021`, nhân công theo cấp bậc |

Bảng 3.3 và 3.7 tra khoảng theo **chi phí xây dựng trước thuế của công trình trong TMĐT được duyệt** (nhập ở tab Cài đặt hệ số, đơn vị
tỷ đồng); để trống thì phần mềm dùng giá trị dự toán và cảnh báo. Không nội suy giữa các khoảng.
Bảng tổng hợp chi phí theo TT 36/2026: T (VL + NC×Knc + M×Km) → C (Bảng 3.3, hoặc Bảng 3.4 theo NC) → TT (Bảng 3.5) →
GT = C + TT → TL (Bảng 3.6) → GXDTT → GTGT → GXD, và dòng riêng **V. Nhà tạm** = GXDTT × Bảng 3.7 × (1 + TGTGT).
Tổng dự toán có hai khoản dự phòng theo Phụ lục II TT 36/2026: GDP1 = G_TDP × kps (kps ≤ 5%) và
GDP2 = Σ G_TDP,t × [(I_bq + ΔI)^t − 1] với lịch phân bổ giá trị theo năm/quý.
Khi nâng cấp từ bản cũ, các công trình đã có được giữ ở bộ lịch sử nên số liệu không đổi.
Chi tiết: [docs/LEGAL-UPDATE-2026.md](docs/LEGAL-UPDATE-2026.md), [docs/UPDATE-2.md](docs/UPDATE-2.md), [docs/DECISIONS.md](docs/DECISIONS.md) mục 27–68.

## Tính năng (Phase 1)
- Đăng nhập, phân quyền quản trị/người dùng, bắt buộc đổi mật khẩu lần đầu.
- Danh sách công trình: tạo, sao chép, xóa, mở.
- **Hạng mục công trình** (CT01 nhà xưởng, A1 văn phòng, bể PCCC…): một công trình có nhiều hạng mục công trình, mỗi hạng mục có Phần/công tác, lưới dự toán,
  bóc khối lượng, phân tích vật tư và tổng hợp chi phí **riêng** (STT khởi động lại); tab **Tổng hợp dự án** cộng tất cả hạng mục + các dòng cấp dự án
  (chi phí quản lý, VAT…) thành tổng dự án. Xem mục 0 dưới đây.
- **Dự toán chi tiết** theo hạng mục, thao tác bàn phím như F1/G8: gõ mã hiệu → Enter tự điền tên, đơn vị; Enter xuống dòng;
  F3 tra định mức (có dấu/không dấu); diễn giải khối lượng dạng công thức `2*3,5*0,3`.
- **Giá vật liệu/nhân công/máy** theo công trình, **Phân tích vật tư**, **Tổng hợp vật tư** (kèm chênh lệch giá).
- **Tổng hợp chi phí** theo bộ pháp lý của công trình (TT 36/2026 Bảng 3.8, hoặc bộ lịch sử TT 11/2021); Knc/Km khi làm đêm;
  Tổng dự toán (thiết bị, QLDA, tư vấn, chi phí khác, 2 khoản dự phòng). Mỗi dòng hiển thị cách tính và **nguồn** (văn bản, số bảng,
  khoảng tra, trạng thái xác minh), đọc số thành chữ.
- **Căn cứ pháp lý**: sổ văn bản (số hiệu, ngày ban hành/hiệu lực, tình trạng, nguồn chính thức), các bộ pháp lý và bảng tỷ lệ;
  quản trị viên đánh dấu từng bảng “đã xác minh” và bật/tắt nội suy.
- **Xuất Excel** một file gồm các sheet TH, DTCT, PTVT, THVT, CLVT, TDT – dùng **công thức Excel thật**, khổ A4, Times New Roman, #,##0.
  Sheet TH ghi rõ căn cứ pháp lý, nguồn từng dòng và cảnh báo khi bảng tỷ lệ còn TẠM.
- **⤓ Nhập từ Excel** (một luồng duy nhất): mỗi sheet của file thành một hạng mục công trình (hoặc thay thế/thêm vào hạng mục có sẵn), từ máy tính
  (.xlsx/.xlsm/.xls/.csv, hoặc đường dẫn tuyệt đối khi chạy cục bộ) hoặc **Google Drive**. Nút phụ "⤓ Nhập dữ liệu (chọn cột tay)" dùng khi cần tự chọn
  lại cột cho một sheet khó (tự nhận diện chưa đúng); cũng dùng để nạp định mức, bảng giá, danh sách công tác (không phải dự toán).
- **Trợ lý AI** (không cần mạng): hiểu lệnh như
  - `thêm 50 m3 bê tông cột mác 300 vào hạng mục phần thân`
  - `tìm mã định mức đào đất móng`
  - `đổi giá xi măng PCB40 thành 1.650.000 đ/tấn`
  - `sửa khối lượng dòng 3 thành 2*3,5*0,3`, `tạo hạng mục phần mái`, `tính lại`, `xuất excel`, `hoàn tác`

  Khi thiếu thông tin hoặc có nhiều lựa chọn, trợ lý **hỏi lại bằng các nút bấm**; mọi thay đổi đều **xem trước** và chỉ thực hiện khi
  bấm **Xác nhận**; có **Hoàn tác**. Nếu đặt `ANTHROPIC_API_KEY`, trợ lý dùng Claude để hiểu câu lệnh tự do hơn.

## Hướng dẫn nhanh các tính năng mới

### 0. Hạng mục công trình (Update 6)
Thanh bên trái của trang công trình liệt kê các **hạng mục công trình** (CT01 nhà xưởng, CT02, A1 văn phòng, bể PCCC, nhà bảo vệ,
đường nội bộ, 01-Điện trung thế…) – mỗi hạng mục là một "công trình con" độc lập trong TMĐT, có Phần/công tác, lưới dự toán (STT
khởi động lại), bóc khối lượng, phân tích vật tư và tổng hợp chi phí **riêng**; không bao giờ tự trộn công việc của hạng mục này
vào hạng mục khác. Thao tác: **+** thêm, **✎** đổi tên, **⧉** sao chép, **🗑** xóa (xác nhận khi còn công việc, có **↶ Hoàn tác**).
Chuyển một Phần sang hạng mục khác chỉ qua hành động "Chuyển sang hạng mục…" rõ ràng (không tự động). Tab **Tổng hợp dự án**: một
dòng mỗi hạng mục (diện tích, giá trị, đơn giá/m²) + các dòng cấp dự án tự đặt (vd. "Chi phí quản lý dự án 3%", "VAT 8%") + tổng
dự án. Khi nâng cấp từ bản cũ, mỗi công trình đã có được gán vào đúng 1 hạng mục "Hạng mục chung" nên số liệu không đổi.

### 1. Nhập file dự toán / BOQ có sẵn (bạn chọn từng cột)
1. Mở công trình → **⤓ Nhập dữ liệu (chọn cột tay)** → loại dữ liệu “Dự toán / BOQ có sẵn” → chọn file `.xlsx`, `.xlsm`, `.xls` hoặc `.csv`
   (hoặc chọn từ Google Drive) → **Đọc file**. Phần mềm liệt kê các sheet kèm loại tự nhận diện và chọn sẵn sheet dự toán.
2. **Vùng dữ liệu**: dòng tiêu đề, số dòng tiêu đề (1 hoặc 2 – nhận diện cả khi KHÔNG gộp ô: ô nhóm “Đơn giá” bên trên các nhãn
   “Vật liệu”, “Nhân công” bên dưới), dòng dữ liệu đầu/cuối.
3. **Chọn cột cho từng trường** (Mã hiệu · Hạng mục công việc · Đơn vị · Khối lượng · Diễn giải khối lượng · Đơn giá vật liệu/nhân công/máy ·
   Đơn giá tổng hợp · Thành tiền · Ghi chú · STT/phân cấp): mỗi trường có ô tích **Lấy cột này** và danh sách MỌI cột có dữ liệu, dạng
   `F – Đơn giá 单价 / Vật liệu (vd: 15.000; 1.150.000…)`. Tự nhận diện chỉ điền sẵn; bạn đổi hoặc chọn “— Không lấy —” tùy ý, kết quả cập nhật ngay.
4. **Đơn giá**: (a) *Giữ nguyên đơn giá trong file* (mặc định) – đơn giá VL/NC/M của file thành đơn giá nhập tay của từng công việc, nguồn ghi
   “File Excel …, ô F6/G6”; (b) *Tính lại theo định mức & bộ giá của công trình*.
5. **Loại dòng**: mỗi dòng có nhãn sửa được *Hạng mục / Công việc / Dòng cộng (bỏ qua) / Ghi chú (bỏ qua)*. Tự nhận: STT chữ/La Mã không có khối
   lượng → hạng mục; dòng “Cộng…”, “Tổng…”, 小计/合计 hoặc công thức `SUM` → dòng cộng.
6. **Công thức không có giá trị lưu sẵn** (file do thư viện ghi, ví dụ `=E6*(F6+G6)`, `=SUM(H6:H8)`): được tính lại từ số liệu trong sheet; công thức
   không tính được bị gắn cờ, không bao giờ nhập thành 0.
7. **Mã hiệu** (đối chiếu bộ định mức của công trình, TT38_2026): *khớp mã*; *mã và tên công việc không khớp – cần kiểm tra* (giữ mã, hiện tên trong
   TT38 và gợi ý; hỏi thêm cấp đất/chiều rộng/chiều sâu khi thiếu); *đề xuất chuyển mã* cho mã kiểu cũ (vd. AF.11111 → AF.11110, cùng họ mã AF.111xx);
   *gợi ý mã* khi không có mã. Cột “Mã đề xuất” có top-3 kèm độ tin cậy; nút **Chấp nhận tất cả mã đề xuất ≥ ngưỡng**. Mã gốc không bị ghi đè.
8. **Kiểm tra độ khớp với file** (✔/⚠ + chênh lệch): theo từng dòng (KL, đơn giá, thành tiền trong file so với tính lại), từng dòng cộng theo hạng mục và
   tổng cộng. Khi nhập, lưới dự toán phản chiếu file: cùng thứ tự, hạng mục, tên, đơn vị, khối lượng, đơn giá, ghi chú; mã đã nhận có phân tích hao
   phí và “giá theo định mức” để so sánh (không cộng vào tổng); mỗi công việc giữ file/sheet/dòng/ô gốc.
9. Tùy chọn: đặt tên **mẫu nhập** để lần sau file cùng mẫu tự nhận ánh xạ. Nhập nhầm thì bấm **↶ Hoàn tác** ở khung trợ lý.

### 1c. Nhập từ Excel (file thật nhiều sheet/nhiều bảng) – luồng chính
Dùng cho hồ sơ nhiều sheet (ví dụ .xls cũ dạng BIFF, 40+ sheet, mỗi sheet một nhà xưởng/hạng mục, có sheet ẩn và sheet tổng hợp
kiểu TONGHOP) **hoặc chỉ 1 sheet** – đây là nút nhập chính của phần mềm. Nút **⤓ Nhập từ Excel**:
1. Tải file → tích chọn sheet cần nhập (sheet ẩn gập lại, mặc định không chọn; sheet tổng hợp chỉ để đối chiếu, không tạo công việc).
2. **Đích** cho mỗi sheet đã chọn: *Tạo hạng mục công trình mới* (tên mặc định lấy từ dòng “Hạng mục: …” hoặc tên sheet, sửa được),
   *Thay thế hạng mục: …* (xóa sạch Phần/công tác cũ của hạng mục đó rồi nhập lại – hoàn tác được) hoặc *Thêm vào hạng mục: …* (giữ
   nguyên nội dung cũ). Mặc định: **một sheet = một hạng mục công trình**; tích “Tách mỗi bảng con thành hạng mục riêng” nếu muốn
   mỗi bảng trong sheet thành một hạng mục của riêng nó.
3. Một sheet có thể lặp lại dòng tiêu đề cho từng hạng mục con – mỗi bảng như vậy (**khối**) được nhận ra riêng và thành **một
   Phần** của hạng mục công trình đó; bấm **Xem trước** để xem 15 dòng đầu như sẽ lên lưới (tên đã chuyển Unicode, phần tiếng Trung tách riêng).
   Dòng “diễn giải khối lượng” (Dài×Rộng×Cao×Số cấu kiện) dưới một công việc gắn vào công việc đó mà không đổi khối lượng của file.
4. Mỗi khối có dấu ✔/⚠ đối chiếu Σ Thành tiền với dòng “Cộng trước thuế” của khối, và nếu có sheet tổng hợp thì đối chiếu thêm
   với dòng của nó. Sheet điện nước/MEP: dòng không có mã định mức đánh dấu “thiết bị/vật tư theo báo giá”, không bắt buộc mã.
5. **Trung thực với file**: khi Thành tiền của một dòng khác KL×đơn giá (ví dụ file ghi 0 dù vẫn có đơn giá vật liệu/nhân công),
   mặc định phần mềm **giữ đúng Thành tiền trong file** (ghi rõ trong ghi chú công việc) để tổng từng khối/sheet luôn khớp
   “Cộng trước thuế”/TONGHOP – chọn **Tính lại theo KL×đơn giá** nếu muốn bỏ qua số của file (áp dụng cho cả lần nhập, hoặc bấm
   🔒/🧮 cạnh “Giá file” trên từng công việc sau khi đã nhập để đổi riêng dòng đó, không cần tải lại file).
6. Áp dụng tạo tất cả hạng mục công trình/Phần đã chọn trong một thao tác, hoàn tác được bằng **↶ Hoàn tác** ở khung trợ lý. Nhập
   lại cùng file sau đó: chọn *Thay thế hạng mục* cho sheet trùng nguồn để cập nhật mà không tạo hạng mục trùng.

Nút **↻ Nhập lại từ file Excel (thay thế hạng mục đã nhập)** cạnh ⚙ trên mỗi hạng mục đã nhập: luôn tải file mới và thay thế
đúng hạng mục đó thành phiên bản hoàn tác được (khác với ⚙ “Sửa lại cột đã nhập” – mở lại dữ liệu đã lưu, không cần tải lại file).

Không bao giờ commit file thật của khách: đặt vào `data/private/` (đã có trong `.gitignore`) rồi chạy
`npm run check:private-import` để xem bảng đối chiếu từng sheet/khối (và dòng gây lệch nếu có) trước khi nhập vào phần mềm.

### 1b. Cập nhật định mức & đơn giá theo khu vực
Nút **Cập nhật định mức & đơn giá theo khu vực** (thanh công cụ công trình; hoặc gõ “cập nhật đơn giá theo khu vực” cho trợ lý):
1. Chọn tỉnh/thành (34 đơn vị) và khu vực (nếu bộ giá chia khu vực), kỳ giá (mặc định tự chọn bộ mới nhất ≤ ngày lập giá; hoặc chọn tháng/quý),
   loại giá cần cập nhật (vật liệu / nhân công / ca máy), bộ định mức (TT38_2026 – hiện trạng thái “cần đối chiếu”). Tùy chọn kiểm tra và chuyển
   mã định mức chưa có trong bộ TT38_2026 (như mục 7 ở trên).
2. **Xem trước**: bộ giá sẽ dùng, tài nguyên đổi giá (giá cũ → mới, nguồn: văn bản/kỳ), tài nguyên không có giá trong bộ đã chọn (giữ giá hiện tại,
   có cảnh báo), công việc bị ảnh hưởng, chênh lệch chi phí trực tiếp / GXDTT / GXD. Giá nhập tay luôn được giữ; công việc dùng giá file/GTT không đổi
   (giá theo định mức chỉ để so sánh). Bộ giá chưa có dòng giá (chỉ thông tin văn bản) bị bỏ qua kèm cảnh báo.
3. **Áp dụng** = tạo phiên bản mới có nhật ký (ai, khi nào, mô tả, GXD trước → sau) và **hoàn tác được**; không áp dụng lên dự toán đã duyệt.
4. Bật “Tự động cập nhật” của công trình: khi nhập bộ giá đã xác minh mới hơn của khu vực sẽ hiện nút **Có bộ giá mới – Cập nhật?** (không tự áp dụng).

### 2. Tra định mức và gắn mã tự động
- Ô tra định mức (F3) nhận mã (`AF.1`, `AF11`), chữ có/không dấu và viết tắt: `BT`, `BTCT`, `VK`, `CT` (cốt thép), `M250`/`B20`, `PCB40`,
  `đk ≤10mm`, `Ø16`, `dày 220`, `đất C2`…
- Trên lưới dự toán, cột **Gợi ý / trạng thái mã** hiện mã đề xuất và độ tin cậy cho công việc chưa có mã: bấm để chấp nhận, hoặc ▾ để xem 5 gợi
  ý kèm lý do (“vì sao”). Đơn vị phải tương thích (m3 ↔ 100m3, kg ↔ tấn được quy đổi tự động, khối lượng gốc vẫn được giữ).
- **⚙ Gắn mã tự động**: chọn ngưỡng (mặc định 80%), xem trước danh sách rồi áp dụng. Công việc dưới ngưỡng giữ trạng thái “cần xem lại”.
  Mã gắn tự động có nhãn “tự động · xác nhận” – phải xác nhận (từng dòng hoặc cả loạt) trước khi bấm **Duyệt dự toán**.
- Trợ lý: gõ “gắn mã cho các công việc chưa có mã” (có thể thêm “ngưỡng 70%”).

### 3. Bộ đơn giá theo khu vực và thời điểm
- Menu **Bộ đơn giá**: quản trị viên thêm bộ (tỉnh/thành, khu vực, cơ quan công bố, số và ngày văn bản, kỳ tháng/quý/năm, loại VL/NC/Máy,
  giá đã/chưa gồm VAT, điều kiện giao hàng, nguồn), rồi **nhập file công bố giá** (mọi mẫu Excel). Dòng khớp tài nguyên theo mã hoặc tên/quy cách;
  dòng chưa khớp vào danh sách **cần xem lại** để gán tay hoặc bỏ qua. Kiểm tra xong bấm **Đánh dấu đã xác minh**.
- Có sẵn một bộ **chỉ có thông tin văn bản** của Sở Xây dựng TP.HCM (công bố giá VLXD tháng 02/2026, 7563/TB-SXD-KTVLXD) – chưa có giá,
  cần tải file chính thức tại soxaydung.hochiminhcity.gov.vn và nhập vào.
- Trong công trình → tab **Giá vật liệu/NC/Máy**: chọn tỉnh/thành (và khu vực) → phần mềm đề xuất các bộ cùng tỉnh có kỳ giá ≤ ngày lập giá →
  thêm bộ cho từng loại tài nguyên, sắp **ưu tiên** → **Xem chênh lệch giá** → **Áp dụng**. Thứ tự áp giá: giá nhập tay → bộ đơn giá theo ưu tiên →
  giá gốc (MẪU). Cột **Nguồn giá** cho biết giá lấy từ đâu (cả trong sheet THVT của file Excel); bấm tên tài nguyên để xem lịch sử giá theo kỳ.

### 4. Bóc tách khối lượng, GTT/báo giá, vận chuyển và kiểm tra
- Nút **⋯** ở cuối mỗi dòng dự toán mở hộp thoại công tác:
  - **Bóc tách khối lượng**: nhiều dòng diễn giải, biểu thức an toàn (`13*5,4*0,1`, `(L+W)*2*H*N` với biến `L=6; W=4; H=3,3; N=2`, `12%`),
    dòng **Trừ** cho lỗ mở, đơn vị dòng (vd. nhập mm3 → tự đổi ra m3). Khối lượng công tác = tổng các dòng.
  - **Cách tính giá**: theo định mức, **GTT** (giá tạm tính/tự lập) hoặc **báo giá thị trường** (nhà cung cấp, số, ngày, hiệu lực, VAT) –
    bắt buộc ghi nguồn giá.
  - **Nguồn gốc**: file/sheet/dòng, mô tả và mã gốc, văn bản gốc nếu file dùng bảng mã cũ, cờ ô lỗi.
- Nhập file cũ dùng **VNI** hoặc **TCVN3** được tự chuyển sang Unicode (bản gốc vẫn lưu); mã `AF11121` được chuẩn hóa thành `AF.11121`;
  dòng mã **GTT** được tính theo giá trong file; ô `#NAME?`, `#REF!` hay công thức liên kết file khác được gắn cờ, không dùng im lặng.
- Tab giá: nút 🚚 để khai báo các chặng **vận chuyển đến công trình**; phần mềm không cộng lại nếu nguồn giá đã gồm vận chuyển.
- Tab **Kiểm tra**: báo cáo lỗi/cảnh báo theo các kiểm tra bắt buộc (khối lượng, đơn giá, đơn vị, hiệu lực định mức, mã chưa gắn, nguồn giá,
  tổng hợp, hệ số bất thường, ô lỗi…).
- Bộ đơn giá lưu thêm địa giới lúc ban hành (tỉnh cũ trước 01/07/2025), trạng thái xác minh, SHA-256 của file nguồn và xem được **bản ghi
  dữ liệu** theo chuẩn `data-contract.md`.

### 5. Bóc khối lượng theo cấu kiện
Tab **Bóc khối lượng** của công trình (song song với Dự toán chi tiết, không thay thế): khai báo cấu kiện kết cấu/kiến trúc →
phần mềm tự sinh công tác và khối lượng theo công thức → đẩy sang dự toán. **Tính bằng tay luôn làm được** (gõ công thức hoặc kích
thước ra khối lượng ngay) – bóc theo cấu kiện là công cụ hỗ trợ thêm, không bắt buộc.

- **Sub-tab Cấu kiện**: chọn loại cấu kiện (Móng đơn/băng, Đài cọc, Giằng móng, Tường móng, Cột, Dầm, Sàn, Vách BTCT, Cầu thang,
  Tường xây, Lanh tô, Nền, Hoàn thiện tự do), đặt tên (vd. "M1"), số lượng, hạng mục và tầng, rồi nhập kích thước (mỗi tham số có
  giá trị mặc định hợp lý). Bảng bên phải hiện ngay các công tác được sinh ra: công thức đã thay số, khối lượng (= công thức ×
  số lượng), mã định mức gợi ý (tra theo bộ định mức TT38_2026 của công trình bằng bộ máy gợi ý mã sẵn có – không bao giờ tự
  bịa mã; chưa đủ tin cậy thì để "chưa có mã", không chặn khối lượng). Một khối lượng sinh ra có thể **sửa tay** (giá trị tính
  toán hiện gạch ngang bên cạnh); lần sinh lại sau (đổi kích thước khác) vẫn giữ đúng giá trị đã sửa.
- Công thức mặc định theo loại cấu kiện (đơn vị m, tính cho 1 cấu kiện, nhân với số lượng):

  | Loại | Công tác chính (công thức) |
  |---|---|
  | Móng đơn | BT móng `a·b·h` · BT lót `(a+2e_l)(b+2e_l)·t_l` · VK `2(a+b)·h` · Đào (m=0) `A·B·H_d`, (m>0) `H_d/6·[A·B+(A+A')(B+B')+A'·B']` với A=a+2e_l+2e_tc, A'=A+2mH_d (và B tương tự) · Đắp = Đào − (BT móng + BT lót) |
  | Cột | BT `b·h·(H−h_dầm)` (hoặc tròn `π·D²/4·H`) · VK `2(b+h)·(H−h_dầm)` |
  | Dầm | BT `b·h·L` · VK `(b+2(h−h_sàn))·L` |
  | Sàn | BT `(S−S_lỗ)·t` · VK `S−S_lỗ` |
  | Tường xây | Diện tích `L·H−S_cửa` · Xây (m³) `diện tích·dày` · Trát 2 mặt `2·diện tích` |
  | Đài cọc | Ép cọc `n·L` · Đập đầu cọc (cái) `n`, (m³) `π·D²/4·đoạn đập·n` (vuông: `D²·đoạn đập·n`) |

  Xem đầy đủ các loại còn lại (Móng băng, Giằng móng, Tường móng, Vách, Cầu thang, Lanh tô, Nền, Hoàn thiện) trong
  `packages/core/src/takeoff.ts` (`ELEMENT_TEMPLATES`) – đây cũng là nơi duy nhất quyết định công thức, không lặp lại ở nơi khác.
  Mọi phép trừ (lỗ mở, cột ăn vào dầm…) đều là **tham số hiển thị** (S_lỗ, h_dầm…), phần mềm không bao giờ tự trừ ngầm.
- **Sub-tab Bảng tính tay**: ô công thức dùng lại đúng bộ phân tích biểu thức an toàn của "Diễn giải khối lượng" (số thập phân
  `,` hoặc `.`, biến đặt tên `a=3,5; b=4,2`, ghi chú sau `//`), có thêm các hàm `tron(x,n)`, `sqrt`, `min`, `max`, `abs`,
  `chuvi_cn(a,b)`, `dt_cn(a,b)`, `dt_tron(d)`, `tt_hop(a,b,h)`, `tt_tru(d,h)`, `tt_chop_cut(a,b,a2,b2,h)` và hằng số `pi`. Ví dụ:
  `a=3,5; b=4,2; 2*(a+b)*0,2*3 // tường bao` → 9,24. **Bảng tính nhanh** (n, A, L, H) tính luôn Tổng diện tích = A·n, Tổng chiều
  dài = L·n, Tổng thể tích = A·H·n, Diện tích xung quanh = L·H·n.
- **Sub-tab Thống kê thép**: nhập Ø (mm), chiều dài 1 thanh (mm, gõ tay hoặc để trống nếu đã nhập L1..L6 theo dạng thanh), số
  thanh/cấu kiện, số cấu kiện → Tổng chiều dài (m), Tổng khối lượng (kg) theo bảng trọng lượng Ø6→Ø32 (kg/m, công thức
  `0,006165·d²` cho Ø khác), gộp theo 3 nhóm đường kính của TT38/2026 (Ø≤10, 10<Ø≤18, Ø>18). Chế độ nhanh (hàm lượng thép
  kg/m³ bê tông) để trống mặc định – **không tự bịa hàm lượng**.
- **Sub-tab Thiết lập**: khai báo các tầng (tên, cao độ, chiều cao) để nhóm cấu kiện theo tầng.
- **Đẩy sang dự toán**: xem trước danh sách công tác (gộp theo hạng mục, cùng loại công tác của nhiều cấu kiện gộp thành 1 dòng
  dự toán với nhiều dòng diễn giải – mỗi dòng ghi rõ cấu kiện × số lượng và công thức), rồi bấm áp dụng = **một phiên bản hoàn
  tác được**. Đẩy lại (sau khi đổi kích thước/số lượng) cập nhật đúng khối lượng, giữ nguyên đơn giá và mã đã xác nhận; nếu khối
  lượng của dòng dự toán đã bị sửa tay sau lần đẩy trước, phần mềm báo **xung đột** và chỉ ghi đè khi được xác nhận.
- **ETABS**: chưa kết nối trực tiếp trong bản này (giao diện web không gọi được API ETABS). Xem [docs/ETABS.md](docs/ETABS.md)
  cho hai hướng sẽ làm sau: nhập bảng xuất từ ETABS ra Excel, hoặc kết nối API trực tiếp trong bản desktop (Electron).

## Cấu trúc thư mục
```
packages/core    Hàm tính toán thuần (đơn giá, tổng hợp chi phí, công thức, bộ hiểu lệnh tiếng Việt) + unit test
packages/server  Express + SQLite (better-sqlite3), JWT, xuất/nhập Excel, API trợ lý
packages/web     Giao diện React + Vite
data/legal/      Sổ văn bản pháp lý và bảng tỷ lệ theo bộ pháp lý (tt36-2026.json, tt11-2021.json)
data/regions.json  34 tỉnh/thành (sau sắp xếp 2025) cho danh sách chọn khu vực
scripts/         make-fixtures.mjs – tạo các file Excel mẫu dùng cho test
data/            dutoan.db (tạo khi chạy)
docs/            SPEC.md, DECISIONS.md, LEGAL-UPDATE-2026.md, google-drive-setup.md
desktop/         Khung Electron (Phase 2)
```

## Lệnh thường dùng
| Lệnh | Tác dụng |
|---|---|
| `npm install` | Cài thư viện |
| `npm run build` | Build core, server, web |
| `npm start` | Chạy bản build tại http://localhost:3000 |
| `npm run dev` | Chế độ phát triển: API cổng 3000 + giao diện Vite cổng 5173 (tự tải lại) |
| `npm test` | Chạy unit test (vitest) |
| `npm run import:tt38` | Nạp bộ định mức TT 38/2026 (9.012 mã, `data/norms/tt38_2026/`) vào DB – chạy lại an toàn |
| `npm run import:tt38-pl7` | Nạp Phụ lục VII (cấp phối vật liệu) để bóc tách “Vữa…” thành xi măng/cát/đá/nước |
| `npm run e2e` | Kiểm thử trình duyệt headless cho Update 3 (xem `e2e/README.md`) |
| `npm run e2e:update5` | Kiểm thử trình duyệt headless cho Bóc khối lượng theo cấu kiện (Update 5) |

Đăng nhập lần đầu: **admin / admin123** (chỉ ở môi trường phát triển) → hệ thống yêu cầu đổi mật khẩu ngay.
Có thể đặt tài khoản khác bằng biến môi trường `ADMIN_USER`, `ADMIN_PASS` (xem `.env.example`) trước lần chạy đầu tiên.

## 1. Chạy trên GitHub Codespaces
1. Trên GitHub, bấm **Code → Codespaces → Create codespace on main**.
2. Codespace tự chạy `npm install && npm run build` (cấu hình trong `.devcontainer/devcontainer.json`).
3. Mở Terminal, chạy `npm start`. Cổng 3000 được chuyển tiếp – bấm **Open in Browser**.
4. Khi phát triển giao diện dùng `npm run dev` và mở cổng 5173.

## 2. Chạy trên máy tính Windows
1. Cài **Node.js 20 LTS hoặc 22 LTS** từ https://nodejs.org (chọn bản Windows Installer .msi, giữ tùy chọn mặc định).
2. Tải mã nguồn: `git clone https://github.com/congxddinhnghiep-commits/Congxddinhnghiep.git`
   (hoặc **Code → Download ZIP** rồi giải nén).
3. Mở **Command Prompt** / **PowerShell** trong thư mục vừa tải, chạy:
   ```
   npm install
   npm run build
   npm start
   ```
4. Mở trình duyệt tại **http://localhost:3000**.
5. Dữ liệu lưu trong `data\dutoan.db` – sao lưu file này để giữ dữ liệu. Khi chạy trên máy cá nhân có thể nhập file bằng đường dẫn
   tuyệt đối, ví dụ `C:\DuLieu\DinhMuc.xlsx`.

> Nếu `npm install` báo lỗi biên dịch `better-sqlite3`, hãy dùng Node.js bản LTS (20/22) – các bản này có sẵn file dựng sẵn.

## 3. Triển khai lên web
Ứng dụng là một tiến trình Node.js duy nhất (API + giao diện) và một file SQLite, nên cần máy chủ có **ổ đĩa lưu trữ bền vững**.

**Máy chủ VPS (Ubuntu) – khuyến nghị**
```bash
# Cài Node.js 22 LTS, git; sau đó:
git clone https://github.com/congxddinhnghiep-commits/Congxddinhnghiep.git dutoan && cd dutoan
npm ci && npm run build
cp .env.example .env   # sửa: NODE_ENV=production, JWT_SECRET=<chuỗi ngẫu nhiên dài>, ADMIN_PASS=<mật khẩu mạnh>, LOCAL_MODE=false
sudo npm i -g pm2
pm2 start npm --name dutoan -- start && pm2 save && pm2 startup
```
Đặt **Nginx** (hoặc Caddy) làm reverse proxy tới `http://127.0.0.1:3000` và bật **HTTPS** (Let's Encrypt).
Sao lưu định kỳ thư mục `data/`.

**Nền tảng PaaS** (Render, Railway, Fly.io…): lệnh build `npm ci && npm run build`, lệnh chạy `npm start`,
gắn ổ đĩa bền vững và đặt `DATA_DIR`/`DB_PATH` trỏ vào ổ đó (nhớ sao chép thư mục `data/legal/` vào `DATA_DIR`).

Biến môi trường quan trọng khi lên web: `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS`, `LOCAL_MODE=false`.

## Nhập dữ liệu chính thức
- **Định mức** (chỉ quản trị viên, chọn bộ đích `TT38_2026` hoặc `TT12_2021`): bảng mỗi dòng một thành phần hao phí với các cột *Mã hiệu ĐM, Tên công tác, Đơn vị,
  Mã tài nguyên, Tên tài nguyên, Đơn vị, Loại (VL/NC/M), Hao phí, Đơn giá*. Mã định mức có thể chỉ ghi ở dòng đầu mỗi nhóm.
- **Bảng giá**: cột *Mã tài nguyên* và *Giá* (áp cho công trình hoặc cập nhật giá gốc thư viện).
- **Công tác**: cột *Mã hiệu, Khối lượng* (tùy chọn *Tên, Đơn vị, Diễn giải, Hạng mục*).

Hộp thoại nhập tự đoán cột theo tiêu đề; có thể chỉnh lại trước khi bấm **Nhập dữ liệu**.
Google Drive cần cấu hình theo [docs/google-drive-setup.md](docs/google-drive-setup.md).

## Kết nối ChatGPT / Claude
Trợ lý có thể chạy bằng **ChatGPT (OpenAI)**, **Claude (Anthropic)** hoặc **chế độ ngoại tuyến** (theo quy tắc, không cần mạng, luôn dùng được).
1. **Đặt khóa API trên máy chủ** (không bao giờ nhập trên trình duyệt): trong `.env` hoặc biến môi trường
   `OPENAI_API_KEY` (tùy chọn `OPENAI_MODEL`, mặc định `gpt-4o`) và/hoặc `ANTHROPIC_API_KEY` (tùy chọn `ANTHROPIC_MODEL`, mặc định `claude-sonnet-5`).
   Trên GitHub Codespaces: Settings → Secrets and variables → Codespaces → New secret (tên như trên), rồi khởi động lại Codespace / ứng dụng.
2. Mở menu **Trợ lý AI** (tài khoản quản trị): chọn ChatGPT / Claude / Ngoại tuyến / Tự chọn, đặt tên mô hình, bấm **Kiểm tra kết nối**.
   Màn hình chỉ hiện “Đã kết nối / Chưa có khóa API” – không hiện, không ghi log, không lưu khóa vào CSDL (CSDL chỉ lưu tên nhà cung cấp và mô hình).
3. Hộp trợ lý ở công trình hiển thị nhà cung cấp đang dùng. Mô hình gọi **công cụ** (tra định mức, gợi ý mã, xem khối lượng/chi phí, tìm vật tư, bộ đơn giá, giải thích
   quy tắc, hướng dẫn nhập file…). Công cụ ghi (thêm/sửa công việc, gán mã, cập nhật theo khu vực, áp bộ đơn giá) **chỉ tạo bản xem trước** – bạn bấm
   **Áp dụng** hoặc **Hủy**; áp dụng là một thao tác hoàn tác được (↶ Hoàn tác, cập nhật khu vực là phiên bản hoàn tác được).
4. Giới hạn mỗi yêu cầu: `AI_MAX_ITERATIONS` (6 bước), `AI_MAX_OUTPUT_TOKENS` (6000), `AI_TIMEOUT_MS` (60000). Lỗi khóa sai / hết hạn mức / mất mạng / quá thời gian
   được báo bằng tiếng Việt và trợ lý **tự chuyển sang chế độ ngoại tuyến** cho yêu cầu đó – không mất thao tác.
Kiểm thử không cần khóa thật: `npm test` dùng nhà cung cấp giả; `npm run e2e:update4-ai` chạy trình duyệt headless với máy chủ OpenAI giả.

## Ghi chú kỹ thuật
Các quyết định thiết kế và giới hạn của Phase 1 được ghi trong [docs/DECISIONS.md](docs/DECISIONS.md).
