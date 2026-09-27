---
name: du-toan-xay-dung-data-vn
description: Tra cứu, xác minh, tải xuống và chuẩn hóa dữ liệu dự toán xây dựng tại Việt Nam từ nguồn chính thức, gồm định mức, giá vật liệu, nhân công, ca máy, chỉ số giá và đơn giá công bố. Dùng khi người dùng yêu cầu tìm văn bản/tệp giá theo tỉnh, khu vực, kỳ tháng/quý/năm; lập danh mục link tải; nhập dữ liệu vào Excel, Google Sheets, cơ sở dữ liệu hoặc phần mềm dự toán; kiểm tra hiệu lực, phạm vi địa bàn, phiên bản và nguồn gốc dữ liệu.
---

# Tra cứu dữ liệu dự toán xây dựng Việt Nam

Thực hiện quy trình có thể kiểm toán: xác định đúng dữ liệu cần dùng, tìm từ nguồn nhà nước, xác nhận phạm vi và hiệu lực, tải nguyên bản, trích xuất có kiểm tra rồi mới nhập vào ứng dụng dự toán. Không tự suy ra giá còn thiếu và không thay hồ sơ công bố bằng dữ liệu thứ cấp.

## Quy trình

1. **Chốt yêu cầu**: lấy loại dữ liệu (định mức, VLXD, nhân công, ca máy, chỉ số giá, đơn giá/bộ đơn giá), địa phương và khu vực, thời điểm lập/điều chỉnh dự toán, loại công trình, đơn vị tính, yêu cầu file (PDF/XLS/XLSX/CSV) và nơi lưu (máy cục bộ, thư mục dự án, Drive/SharePoint nếu có quyền truy cập). Nếu chưa đủ thông tin, tìm các nguồn độc lập trước; chỉ hỏi khi phạm vi địa lý hoặc kỳ áp dụng làm thay đổi kết quả.
2. **Tìm nguồn**: ưu tiên văn bản/tệp do Bộ Xây dựng, UBND, Sở Xây dựng, Công báo hoặc cổng dữ liệu mở của chính quyền phát hành. Dùng `nguon-chinh-thuc.md` làm điểm xuất phát. Trang Viện Kinh tế xây dựng hữu ích để lập chỉ mục, nhưng mở văn bản/tệp gốc để xác minh trước khi nhập.
3. **Xác minh địa bàn và thời gian**: ghi cả địa giới tại thời điểm ban hành và địa giới hiện tại. Với hồ sơ 2025, kiểm tra hồ sơ phát hành trước hay sau ngày thay đổi đơn vị hành chính. Không gán bảng giá tỉnh cũ cho tỉnh/thành mới nếu chưa xác định khu vực/địa danh trong phụ lục.
4. **Xác minh văn bản**: đối chiếu cơ quan ban hành, số/ký hiệu, ngày ký, kỳ giá, phụ lục, tình trạng thay thế/đính chính, khu vực áp dụng, VAT, điều kiện giao nhận/vận chuyển, mỏ/nhà cung cấp và loại công trình. Tìm văn bản sửa đổi hoặc thay thế mới hơn trong cùng nguồn chính thức.
5. **Lập danh mục trước khi tải hàng loạt**: trả bảng có địa phương, dữ liệu, kỳ giá, số văn bản, ngày ban hành, cơ quan, phạm vi, tệp, link tải, trang công bố, trạng thái xác minh. Phân biệt rõ link PDF/XLS trực tiếp với link trang công bố có nút tải. Nếu nguồn không tải được hoặc tệp bị chặn, đưa link trang văn bản và ghi rõ giới hạn; không dựng link giả.
6. **Tải bản gốc**: dùng chức năng tải của trình duyệt hoặc `download_publication.py` khi môi trường cho phép. Chỉ tải file công khai từ nguồn được xác nhận; không đăng nhập giả, vượt hạn chế truy cập, bỏ qua CAPTCHA hoặc truy cập Drive riêng tư không được cấp quyền. Lưu file nguyên trạng và bản ghi nguồn/sha256; không ghi đè file đã lưu khi tài liệu có phiên bản mới.
7. **Trích xuất và chuẩn hóa**: đọc PDF/XLSX; giữ nguyên nội dung gốc, đơn vị và ghi chú; chuẩn hóa thành bản ghi theo `data-contract.md`. Dùng mã định danh riêng cho dòng giá; không gộp vật liệu khác quy cách, xuất xứ, thương hiệu, địa điểm giao, trạng thái VAT hoặc kỳ giá.
8. **Kiểm tra trước khi nhập ứng dụng**: so sánh số văn bản và tổng số dòng với tệp; kiểm tra đơn vị, cột số, dấu thập phân, thuế, trùng lặp, giá âm/0 bất thường, tệp thiếu trang/phụ lục và địa danh. Chạy đối soát mẫu giữa dữ liệu nhập và PDF/XLS gốc. Đánh dấu ngoại lệ để người phụ trách duyệt.
9. **Nhập có kiểm soát**: thêm dữ liệu theo batch/version mới, không sửa trực tiếp lịch sử đã được dùng cho dự toán. Lưu liên kết giá tới mã dự toán/dòng BOQ và snapshot nguồn; ghi người nhập, thời gian, lần tải, checksum, phiên bản parser và kết quả kiểm tra. Hỗ trợ rollback hoặc đánh dấu ngừng áp dụng.
10. **Báo kết quả**: nêu nguồn đã dùng, kỳ và phạm vi áp dụng, tệp tải được, link, dữ liệu đã trích/nhập, số dòng, lỗi hoặc phần chưa xác minh. Gắn nhãn `ĐÃ XÁC MINH`, `CHƯA ĐỦ CĂN CỨ` hoặc `CẦN DUYỆT`; không gọi toàn bộ bảng giá công bố là đơn giá thanh toán.

## Quy tắc chọn và áp dụng dữ liệu

- Định mức và giá là hai lớp khác nhau. Định mức cung cấp hao phí/nguồn lực; giá địa phương/khảo sát và điều kiện công trình dùng để xác định đơn giá. Không lấy giá VLXD công bố làm giá thanh quyết toán mặc định.
- Chọn kỳ giá theo thời điểm và quy định áp dụng cho hồ sơ cụ thể; kiểm tra văn bản hướng dẫn chi phí hiện hành trên nguồn chính thức trước khi kết luận pháp lý. Không đưa số hiệu thông tư/nghị định vào phần mềm như quy tắc cố định nếu chưa xác nhận còn hiệu lực.
- Giá công bố có thể chỉ để tham khảo và thường cần điều chỉnh theo vị trí công trình, nguồn cung, cự ly vận chuyển, chất lượng, quy cách, điều kiện thương mại và thuế. Ghi các yếu tố này thành trường dữ liệu, không nhúng ngầm vào đơn giá.
- Khi vật liệu không có trong công bố hoặc không phù hợp, chuyển sang nhánh khảo sát/báo giá thị trường theo quy định và quy trình của chủ đầu tư; lưu báo giá, ngày nhận, nhà cung cấp và cơ sở lựa chọn. Không nội suy từ vật liệu gần giống trừ khi có phê duyệt và ghi rõ phương pháp.
- Giữ song song `giá nguồn`, `điều chỉnh được duyệt`, `giá áp dụng`, `công thức/diễn giải`, `người duyệt`. Không ghi đè giá nguồn bằng giá áp dụng.
- Nếu người dùng yêu cầu Google Drive/Sheets, thao tác trong tài khoản và thư mục đã kết nối, dùng đúng quyền chia sẻ; nếu không có tích hợp, tạo file XLSX/CSV tải về và hướng dẫn nhập. Không gửi dữ liệu sang bên ngoài khi chưa được yêu cầu.

## Tệp tham khảo và công cụ

- Mở [nguon-chinh-thuc.md](nguon-chinh-thuc.md) khi chọn cơ quan, link danh mục tỉnh/thành hoặc kiểm tra địa giới sau sắp xếp.
- Mở [data-contract.md](data-contract.md) khi trích xuất hoặc chuẩn hóa dữ liệu cho phần mềm/Excel.
- Dùng [download_publication.py](download_publication.py) để tải một link công khai đã xác minh và tạo manifest kèm SHA-256. Script không xác nhận tính pháp lý của giá hoặc nội dung PDF.
