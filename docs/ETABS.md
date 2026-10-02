# Kết nối ETABS — chưa triển khai trong bản này (fallback / giai đoạn sau)

Update 5 (`docs/UPDATE-5.md`, mục H) yêu cầu chỉ **chuẩn bị giao diện** cho nguồn dữ liệu ETABS, không kết nối thật. Mục này ghi
lại thiết kế và hai hướng sẽ làm khi triển khai, để không phải thiết kế lại từ đầu.

## Hiện trạng
`packages/core/src/takeoff.ts` định nghĩa interface `ElementSource`:

```ts
export interface ElementSource {
  listStories(): Promise<EtabsStoryInfo[]>;
  listFrames(): Promise<EtabsFrameInfo[]>; // cột/dầm: tiết diện b×h hoặc tròn, chiều dài
  listAreas(): Promise<EtabsAreaInfo[]>;   // sàn/vách: chiều dày, diện tích
}
```

và một cài đặt duy nhất, `UnsupportedElementSource`, luôn báo lỗi rõ ràng bằng tiếng Việt: *"Chưa hỗ trợ trong bản này: kết nối
trực tiếp tới ETABS. Hãy xuất bảng… từ ETABS ra Excel và dùng chức năng Nhập dữ liệu, hoặc xem docs/ETABS.md."* Không có route
API hay nút bấm nào gọi ETABS thật; nút duy nhất liên quan (tab Bóc khối lượng → Thiết lập) chỉ hiển thị ghi chú trỏ tới tài liệu
này.

## Vì sao chưa làm ngay
- **Trình duyệt không gọi được API ETABS**: CSI ETABS chỉ cung cấp API COM (Windows, trong tiến trình có ETABS đang chạy hoặc kết
  nối tới nó qua `cOAPI`/`cSapModel`). Một ứng dụng web chạy trên máy chủ (hoặc trên máy khác với máy có ETABS) không thể gọi API
  này qua HTTP.
- Việc nhập khối lượng/kích thước kết cấu **vẫn phải dùng được ngay** không qua ETABS (yêu cầu cốt lõi của Update 5) – đã có đủ ở
  tab Bóc khối lượng (nhập tay) và ở chức năng Nhập dữ liệu (Excel) hiện có.

## Hướng 1 — Nhập bảng xuất từ ETABS ra Excel (ưu tiên, dùng được trên web)
ETABS có thể xuất các bảng sau (File → Print Tables, hoặc Database Tables) ra Excel/CSV:
1. **Story Definitions** – tên tầng, cao độ, chiều cao từng tầng → map thẳng vào bảng `stories`.
2. **Frame Section Definitions** – tiết diện cột/dầm (b×h hoặc D) theo tên mặt cắt.
3. **Frame Assignments – Section Properties** + **Frame Connectivity/Lengths** – gán mặt cắt cho từng phần tử, tọa độ 2 đầu
   (suy ra chiều dài) và tầng chứa nó → mỗi dòng map thành 1 `takeoff_elements` loại `cot` hoặc `dam`.
4. **Area/Shell Assignments – Section Properties** – chiều dày và diện tích sàn/vách → map thành `takeoff_elements` loại `san`
   hoặc `vach`.

Cách làm khi triển khai: thêm một bước phân tích file tương tự `packages/server/src/estimate-import.ts`/`import-multi.ts` (đã có
sẵn bộ máy dò bảng, ánh xạ cột do người dùng xác nhận, chuẩn hóa VNI/TCVN3…) nhận diện 4 bảng trên theo tiêu đề cột đặc trưng của
ETABS, rồi tạo `takeoff_elements` qua `TakeoffService.createElement` hiện có (`source: 'excel'`, `sourceRef` = tên bảng/dòng).
Không cần sửa `ElementSource`; chỉ cần một hàm `parseEtabsExport(file): { stories, frames, areas }` dùng lại các hàm đọc Excel đã
có, không phải viết lại bộ đọc Excel.

## Hướng 2 — API trực tiếp, chỉ trong bản desktop (Electron)
Phase 2 của dự án (`desktop/`, khung Electron) chạy trên máy Windows có cài ETABS, nên tiến trình chính (main process) có thể:
1. Dùng thư viện COM interop (vd. `node-ffi`/`edge-js`, hoặc gọi một trợ lý `.NET`/`csi` nhỏ qua stdio) để lấy `cOAPI` của một
   phiên ETABS đang mở.
2. Đọc các bảng tương đương Hướng 1 trực tiếp qua API (`SapModel.PropFrame`, `SapModel.FrameObj`, `SapModel.AreaObj`,
   `SapModel.Story`…) thay vì qua file Excel trung gian.
3. Cài đặt một `ElementSource` thật (vd. `EtabsComElementSource`) trong tiến trình Electron, gọi qua IPC tới renderer, rồi dùng
   lại đúng `TakeoffService.createElement` ở phía server nhúng (giữ nguyên toàn bộ logic tính toán/đẩy sang dự toán).
4. Vẫn giữ `UnsupportedElementSource` làm mặc định trên bản web; chỉ bản Electron mới chọn cài đặt COM khi phát hiện đang chạy
   trên Windows và có ETABS.

Không triển khai Hướng 2 cho tới khi có bản desktop ổn định, vì nó phụ thuộc hoàn toàn vào môi trường Windows + ETABS cài sẵn,
không kiểm thử tự động được trong CI.
