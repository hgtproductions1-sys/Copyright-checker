export const STUDIO_CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB raw binary chunks (well under 32 MB proxy limits)

const bufferUploadIdCache = new WeakMap<ArrayBuffer, string>();

export interface ChunkSlicePlan {
  chunkIndex: number;
  start: number;
  end: number;
}

export function planChunkSlices(
  totalBytes: number,
  chunkSizeBytes = STUDIO_CHUNK_SIZE_BYTES
): ChunkSlicePlan[] {
  if (totalBytes <= 0) return [];
  const safeChunk = Math.max(1024, chunkSizeBytes);
  const slices: ChunkSlicePlan[] = [];
  let chunkIndex = 0;
  for (let start = 0; start < totalBytes; start += safeChunk) {
    slices.push({
      chunkIndex,
      start,
      end: Math.min(totalBytes, start + safeChunk),
    });
    chunkIndex++;
  }
  return slices;
}

function createUploadToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `up_${crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  }
  return `up_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function invalidateStudioUploadId(bytes: ArrayBuffer): void {
  bufferUploadIdCache.delete(bytes);
}

export async function ensureStudioUploadId(
  bytes: ArrayBuffer,
  fileName: string,
  forceFresh = false
): Promise<string> {
  if (!forceFresh) {
    const cached = bufferUploadIdCache.get(bytes);
    if (cached) {
      return cached;
    }
  }

  const slices = planChunkSlices(bytes.byteLength, STUDIO_CHUNK_SIZE_BYTES);
  if (slices.length === 0) {
    throw new Error(`Cannot upload empty file "${fileName}".`);
  }

  const uploadId = createUploadToken();
  const totalChunks = slices.length;

  for (const slice of slices) {
    const chunkBuf = bytes.slice(slice.start, slice.end);
    const params = new URLSearchParams({
      uploadId,
      chunkIndex: String(slice.chunkIndex),
      totalChunks: String(totalChunks),
      filename: fileName || 'studio-track',
    });

    const res = await fetch(`/api/studio-upload-chunk?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: chunkBuf,
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        errBody.error ||
          `Chunk ${slice.chunkIndex + 1}/${totalChunks} upload failed (HTTP ${res.status})`
      );
    }
  }

  bufferUploadIdCache.set(bytes, uploadId);
  return uploadId;
}
