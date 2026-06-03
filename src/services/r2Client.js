'use strict';
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');

/**
 * Vytvoří R2 klienta s jednoduchým rozhraním { put, list, delete, get, bucket }.
 * Vyhodí chybu, pokud chybí povinné ENV.
 */
function createR2Client(env = process.env) {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('Chybí R2 ENV (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)');
  }

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  return {
    bucket: R2_BUCKET,

    async put(key, body) {
      await client.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body }));
    },

    /** Vrací [{ key, lastModified, sizeBytes }] pro daný prefix. */
    async list(prefix) {
      const out = [];
      let token;
      do {
        const res = await client.send(new ListObjectsV2Command({
          Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token,
        }));
        for (const o of res.Contents || []) {
          out.push({ key: o.Key, lastModified: o.LastModified, sizeBytes: o.Size });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },

    async delete(keys) {
      if (!keys.length) return;
      await client.send(new DeleteObjectsCommand({
        Bucket: R2_BUCKET,
        Delete: { Objects: keys.map((Key) => ({ Key })) },
      }));
    },

    /** Stáhne objekt jako Buffer. */
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      const chunks = [];
      for await (const chunk of res.Body) chunks.push(chunk);
      return Buffer.concat(chunks);
    },
  };
}

module.exports = { createR2Client };
