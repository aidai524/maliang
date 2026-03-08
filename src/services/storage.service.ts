import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import OSS from 'ali-oss';
import { config } from '../config/env';
import { StorageError } from '../utils/errors';
import { createLogger } from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';

const logger = createLogger('storage');

// Initialize clients for remote object storage backends
let r2Client: S3Client | null = null;
let ossClient: OSS | null = null;

if (config.r2) {
  r2Client = new S3Client({
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });
  logger.info('R2 storage initialized');
}

if (config.oss) {
  ossClient = new OSS({
    region: config.oss.region,
    endpoint: config.oss.endpoint,
    accessKeyId: config.oss.accessKeyId,
    accessKeySecret: config.oss.accessKeySecret,
    bucket: config.oss.bucket,
  });
  logger.info('OSS storage initialized');
}

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

export type StoredImage = {
  url: string;
  key: string;
  contentType: string;
};

async function ensurePublicDir() {
  try {
    await fs.access(PUBLIC_DIR);
  } catch {
    await fs.mkdir(PUBLIC_DIR, { recursive: true });
  }
}

async function ensureImagesDir() {
  try {
    await fs.access(IMAGES_DIR);
  } catch {
    await fs.mkdir(IMAGES_DIR, { recursive: true });
  }
}

/**
 * Store an image to local filesystem and return its public URL
 */
async function putImageLocal(
  buffer: Buffer,
  options: {
    contentType?: string;
    filename?: string;
  } = {}
): Promise<StoredImage> {
  const { contentType = 'image/png', filename } = options;

  await ensureImagesDir();

  const key = filename || `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
  const filepath = path.join(IMAGES_DIR, key);

  try {
    await fs.writeFile(filepath, buffer);

    const url = `${config.storage.publicBaseUrl}/images/${key}`;

    logger.info('Image stored locally', { key, url, size: buffer.length });

    return { url, key, contentType };
  } catch (error) {
    logger.error('Failed to store image locally', { error, key });
    throw new StorageError(`Failed to store image locally: ${error}`);
  }
}

/**
 * Store an image to R2 and return its public URL
 */
async function putImageR2(
  buffer: Buffer,
  options: {
    contentType?: string;
    filename?: string;
  } = {}
): Promise<StoredImage> {
  if (!r2Client || !config.r2) {
    throw new StorageError('R2 storage not configured');
  }

  const { contentType = 'image/png', filename } = options;
  const bucket = config.r2.bucket;

  const key = filename || `images/${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await r2Client.send(command);

    const url = `${config.r2.publicBaseUrl}/${key}`;

    logger.info('Image stored to R2', { key, url, size: buffer.length });

    return { url, key, contentType };
  } catch (error) {
    logger.error('Failed to store image to R2', { error, key });
    throw new StorageError(`Failed to store image to R2: ${error}`);
  }
}

/**
 * Store an image to Alibaba Cloud OSS and return its public URL
 */
async function putImageOss(
  buffer: Buffer,
  options: {
    contentType?: string;
    filename?: string;
  } = {}
): Promise<StoredImage> {
  if (!ossClient || !config.oss) {
    throw new StorageError('OSS storage not configured');
  }

  const { contentType = 'image/png', filename } = options;
  const key = filename || `images/${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    await ossClient.put(key, buffer, {
      headers: {
        'Content-Type': contentType,
        'x-oss-object-acl': 'public-read',
      },
    });

    const url = `${config.oss.publicBaseUrl}/${key}`;
    logger.info('Image stored to OSS', { key, url, size: buffer.length });
    return { url, key, contentType };
  } catch (error) {
    logger.error('Failed to store image to OSS', { error, key });
    throw new StorageError(`Failed to store image to OSS: ${error}`);
  }
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * Store an image (auto-select storage backend)
 */
export async function putImage(
  buffer: Buffer,
  options: {
    contentType?: string;
    filename?: string;
  } = {}
): Promise<StoredImage> {
  if (config.storage.type === 'local') {
    return putImageLocal(buffer, options);
  }

  if (config.storage.type === 'r2') {
    return putImageR2(buffer, options);
  }

  if (config.storage.type === 'oss') {
    return putImageOss(buffer, options);
  }

  throw new StorageError(`Unsupported storage type: ${config.storage.type}`);
}

/**
 * Get an image from configured storage backend
 */
export async function getImage(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (config.storage.type === 'local') {
    const filepath = path.join(IMAGES_DIR, key);
    const buffer = await fs.readFile(filepath);
    return { buffer, contentType: 'image/png' };
  }

  if (config.storage.type === 'r2') {
    if (!r2Client || !config.r2) {
      throw new StorageError('R2 storage not configured');
    }

    const bucket = config.r2.bucket;

    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await r2Client.send(command);

      if (!response.Body) {
        throw new StorageError('Empty response body');
      }

      const buffer = Buffer.from(await response.Body.transformToByteArray());
      const contentType = response.ContentType || 'image/png';

      return { buffer, contentType };
    } catch (error) {
      logger.error('Failed to get image from R2', { error, key });
      throw new StorageError(`Failed to get image from R2: ${error}`);
    }
  }

  if (config.storage.type === 'oss') {
    if (!ossClient) {
      throw new StorageError('OSS storage not configured');
    }

    try {
      const response = await ossClient.get(key);
      const responseHeaders = response.res?.headers as
        | Record<string, string | string[] | undefined>
        | undefined;
      const rawContentType = responseHeaders?.['content-type'];
      const contentType = Array.isArray(rawContentType)
        ? rawContentType[0] || 'image/png'
        : rawContentType || 'image/png';

      if (Buffer.isBuffer(response.content)) {
        return { buffer: response.content, contentType };
      }

      if (typeof response.content === 'string') {
        return { buffer: Buffer.from(response.content), contentType };
      }

      if (response.content instanceof Readable) {
        const buffer = await readStreamToBuffer(response.content);
        return { buffer, contentType };
      }

      throw new StorageError('Unsupported OSS response content type');
    } catch (error) {
      logger.error('Failed to get image from OSS', { error, key });
      throw new StorageError(`Failed to get image from OSS: ${error}`);
    }
  }

  throw new StorageError(`Unsupported storage type: ${config.storage.type}`);
}

/**
 * Download an image from a URL and return it as a Buffer
 */
export async function downloadImage(url: string): Promise<Buffer> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new StorageError(`Failed to download: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    logger.info('Image downloaded', { url, size: buffer.length });

    return buffer;
  } catch (error) {
    logger.error('Failed to download image', { error, url });
    throw new StorageError(`Failed to download image from ${url}: ${error}`);
  }
}

/**
 * Store an image from a URL (download + upload)
 */
export async function storeImageFromUrl(
  url: string,
  options: { filename?: string } = {}
): Promise<StoredImage> {
  const buffer = await downloadImage(url);
  return putImage(buffer, options);
}
