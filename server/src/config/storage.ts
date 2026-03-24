import { S3Client } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

export const MEDIA_BUCKET = process.env.S3_MEDIA_BUCKET || 'cross-poster-media';
export const MEDIA_PUBLIC_URL = process.env.S3_PUBLIC_URL || '';

export default s3Client;
