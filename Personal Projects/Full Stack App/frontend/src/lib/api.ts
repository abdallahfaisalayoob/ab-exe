import type { ProjectResponse, SampleProject } from "../types/simulator";

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
      }
    } catch {
      // Keep status text when the backend returns a non-JSON error.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function assetUrl(path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  return `${API_BASE}${path}`;
}

export async function fetchSamples(): Promise<SampleProject[]> {
  const payload = await parseJson<{ samples: SampleProject[] }>(await fetch(`${API_BASE}/api/samples`));
  return payload.samples;
}

export async function loadDemo(sampleId: string): Promise<ProjectResponse> {
  return parseJson<ProjectResponse>(
    await fetch(`${API_BASE}/api/projects/demo/${sampleId}`, {
      method: "POST",
    })
  );
}

export async function uploadDesign(file: File): Promise<ProjectResponse> {
  const data = new FormData();
  data.append("file", file);
  return parseJson<ProjectResponse>(
    await fetch(`${API_BASE}/api/projects/upload`, {
      method: "POST",
      body: data,
    })
  );
}
