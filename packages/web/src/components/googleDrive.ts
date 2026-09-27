/* Google Picker + Google Identity Services loader (loaded on demand). */
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    gapi?: any;
    google?: any;
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Không tải được ${src}`));
    document.head.appendChild(s);
  });
}

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
  accessToken: string;
}

const MIME_TYPES = [
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
].join(',');

/** Ask for an OAuth token, open Google Picker and resolve with the chosen file (null if cancelled). */
export async function pickDriveFile(cfg: { clientId: string; apiKey: string; appId: string }): Promise<PickedFile | null> {
  await Promise.all([loadScript('https://apis.google.com/js/api.js'), loadScript('https://accounts.google.com/gsi/client')]);
  await new Promise<void>((resolve) => window.gapi.load('picker', resolve));
  // drive.file only grants access to files the user picks; it requires the app id (project number).
  const scope = cfg.appId ? 'https://www.googleapis.com/auth/drive.file' : 'https://www.googleapis.com/auth/drive.readonly';
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope,
      callback: (resp: any) => (resp.error ? reject(new Error(resp.error)) : resolve(resp.access_token)),
    });
    client.requestAccessToken();
  });
  return new Promise((resolve) => {
    const picker = window.google.picker;
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(MIME_TYPES).setIncludeFolders(true);
    let builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(cfg.apiKey)
      .setLocale('vi')
      .setTitle('Chọn file dữ liệu (.xlsx, .csv, Google Sheets)')
      .setCallback((data: any) => {
        if (data.action === picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name, mimeType: d.mimeType, accessToken });
        } else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    if (cfg.appId) builder = builder.setAppId(cfg.appId);
    builder.build().setVisible(true);
  });
}
