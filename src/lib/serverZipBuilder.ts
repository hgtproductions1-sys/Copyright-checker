import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export interface ZipInputEntry {
  archivePath: string;
  data: Buffer;
  mtime?: Date;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeDosTimeDate(date: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);
  return { dosTime, dosDate };
}

/**
 * Builds a valid standard PKZIP archive buffer using Node's built-in deflateRawSync.
 */
export function buildZipArchiveBuffer(entries: ZipInputEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanArchivePath = entry.archivePath
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const nameBuf = Buffer.from(cleanArchivePath, 'utf8');
    const uncompressed = entry.data;
    const checksum = crc32(uncompressed);
    const compressed = zlib.deflateRawSync(uncompressed, { level: 6 });
    const useDeflate = compressed.length < uncompressed.length;
    const payload = useDeflate ? compressed : uncompressed;
    const method = useDeflate ? 8 : 0;
    const { dosTime, dosDate } = encodeDosTimeDate(entry.mtime ?? new Date());

    // Local File Header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len

    localParts.push(localHeader, nameBuf, payload);

    // Central Directory File Header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 filename flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra len
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

const ALLOWED_ROOT_FILES = [
  '.env.example',
  '.gitignore',
  'index.html',
  'metadata.json',
  'package.json',
  'server.ts',
  'tsconfig.json',
  'vite.config.ts',
];

const EXCLUDED_RELATIVE_PREFIXES = [
  'src/assets/images',
  'node_modules',
  'dist',
  '.git',
  '.playwright-cli',
  '.aistudio',
];

export async function collectProjectZipEntries(
  rootDir: string,
  archivePrefix = 'origisound-app'
): Promise<ZipInputEntry[]> {
  const resolvedRoot = path.resolve(rootDir);
  const entries: ZipInputEntry[] = [];

  for (const filename of ALLOWED_ROOT_FILES) {
    const absPath = path.resolve(resolvedRoot, filename);
    if (!absPath.startsWith(resolvedRoot + path.sep)) continue;
    try {
      const stat = await fs.promises.lstat(absPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const data = await fs.promises.readFile(absPath);
      entries.push({
        archivePath: `${archivePrefix}/${filename}`,
        data,
        mtime: stat.mtime,
      });
    } catch {
      // Skip optional files not present
    }
  }

  const walkSrcDir = async (dirPath: string): Promise<void> => {
    const dirEntries = await fs.promises.readdir(dirPath, {
      withFileTypes: true,
    });
    dirEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirEntries) {
      if (dirent.isSymbolicLink()) continue;
      if (dirent.name.startsWith('.env')) continue;

      const absChild = path.resolve(dirPath, dirent.name);
      if (!absChild.startsWith(resolvedRoot + path.sep)) continue;

      const relFromRoot = path
        .relative(resolvedRoot, absChild)
        .replace(/\\/g, '/');

      if (
        EXCLUDED_RELATIVE_PREFIXES.some(
          (prefix) =>
            relFromRoot === prefix || relFromRoot.startsWith(`${prefix}/`)
        )
      ) {
        continue;
      }

      if (dirent.isDirectory()) {
        await walkSrcDir(absChild);
      } else if (dirent.isFile()) {
        const stat = await fs.promises.lstat(absChild);
        const data = await fs.promises.readFile(absChild);
        entries.push({
          archivePath: `${archivePrefix}/${relFromRoot}`,
          data,
          mtime: stat.mtime,
        });
      }
    }
  };

  const srcDir = path.resolve(resolvedRoot, 'src');
  if (fs.existsSync(srcDir)) {
    await walkSrcDir(srcDir);
  }

  return entries;
}
