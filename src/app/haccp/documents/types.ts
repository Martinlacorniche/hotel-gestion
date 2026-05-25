import type { DocumentCategory } from './categories';

export type HACCPDocument = {
  id: string;
  hotel_id: string;
  category: DocumentCategory;
  name: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  valid_until: string | null;
  version: number;
  notes: string | null;
  uploaded_by: string | null;
  created_at: string;
  replaced_at: string | null;
};

export type Hotel = { id: string; nom: string };
