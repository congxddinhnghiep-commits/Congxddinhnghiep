import { HttpError } from './repo.js';

const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Download a file picked with Google Picker, using the user's OAuth access token
 * (scope drive.file / drive.readonly). Google Sheets are exported as .xlsx.
 */
export async function downloadDriveFile(fileId: string, accessToken: string, mimeType: string, name: string): Promise<{ buffer: Buffer; fileName: string }> {
  if (!/^[\w-]+$/.test(fileId)) throw new HttpError(400, 'Mã file Google Drive không hợp lệ');
  const base = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`;
  const isSheet = mimeType === GOOGLE_SHEET;
  const url = isSheet ? `${base}/export?mimeType=${encodeURIComponent(XLSX)}` : `${base}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new HttpError(502, `Google Drive trả lỗi ${res.status}. Kiểm tra quyền truy cập file.`);
  const buffer = Buffer.from(await res.arrayBuffer());
  let fileName = name || 'drive-file';
  if (isSheet && !fileName.toLowerCase().endsWith('.xlsx')) fileName += '.xlsx';
  return { buffer, fileName };
}
