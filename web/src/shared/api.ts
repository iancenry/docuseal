export function csrfToken(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
  return meta?.content ?? '';
}

export interface TemplateListItem {
  id: number;
  name: string;
  slug: string;
  updated_at: string;
  archived_at: string | null;
  author?: { email?: string } | null;
}

export interface TemplatesResponse {
  data?: TemplateListItem[];
  pagination?: { page: number; per_page: number; count: number; total_pages: number };
  error?: string;
}

// Session-cookie auth (GET /templates). The Bearer-token endpoint is /api/templates,
// which browser islands cannot call without an embed token.
export async function fetchTemplates(page = 1): Promise<TemplatesResponse> {
  const res = await fetch(`/templates?page=${encodeURIComponent(String(page))}`, {
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken() },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    return { error: `Request failed with status ${res.status}` };
  }
  return (await res.json()) as TemplatesResponse;
}
