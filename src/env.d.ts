/// <reference types="vite/client" />

// CDN globals used in index.html
declare const supabase: any;

interface ImportMetaEnv {
  readonly VITE_SB_URL: string;
  readonly VITE_SB_KEY: string;
  readonly VITE_ALLOWED_EMAILS: string;
  readonly VITE_FOLDER_LOGISTICAS: string;
  readonly VITE_WA_EDGE_URL: string;
  readonly VITE_EMAIL_EDGE_URL: string;
  readonly VITE_EMAIL_SEGURO: string;
  readonly VITE_DRIVE_FOLDER_ID: string;
  readonly VITE_FOTOS_FOLDER_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
