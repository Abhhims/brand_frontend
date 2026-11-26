/**
 * Object storage (S3-compatible: RustFS/MinIO locally, AWS S3 in the cloud) for brand assets and evidence files.
 * Path-style addressing, bucket created on first use, files served as downloads
 * except safe raster images, and short-lived signed download links instead of public files.
 */
import { createHash } from "node:crypto"
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

export interface StorageSettings {
  endpoint: string
  /** host used in links handed to browsers, when it differs from `endpoint` */
  publicEndpoint?: string
  accessKey: string
  secretKey: string
  bucket: string
  region: string
  urlExpireSeconds: number
}

export interface StoredObject {
  storageKey: string
  contentType: string
  sha256: string
  size: number
}

export class ObjectStorage {
  private readonly client: S3Client
  private readonly publicClient: S3Client
  private bucketReady: Promise<void> | undefined

  constructor(private readonly s: StorageSettings) {
    const make = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: s.region,
        forcePathStyle: true,
        credentials: { accessKeyId: s.accessKey, secretAccessKey: s.secretKey },
      })
    this.client = make(s.endpoint)
    this.publicClient = s.publicEndpoint ? make(s.publicEndpoint) : this.client
  }

  /** Store bytes under `key`. Raster images are viewable inline; everything else downloads (hostile HTML/SVG never renders). */
  async put(key: string, data: Buffer, contentType?: string | null): Promise<StoredObject> {
    await this.ensureBucket()
    const type = contentType || "application/octet-stream"
    const inline = type.startsWith("image/") && type !== "image/svg+xml"
    const filename = key.split("/").pop() ?? "file"
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.s.bucket,
        Key: key,
        Body: data,
        ContentType: type,
        ContentDisposition: `${inline ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"`,
      }),
    )
    return { storageKey: key, contentType: type, sha256: createHash("sha256").update(data).digest("hex"), size: data.length }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.s.bucket, Key: key }))
    return Buffer.from(await res.Body!.transformToByteArray())
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.s.bucket, Key: key }))
  }

  /** Time-limited download link (signing is local: no network call) */
  async signedUrl(key: string): Promise<string> {
    return getSignedUrl(this.publicClient, new GetObjectCommand({ Bucket: this.s.bucket, Key: key }), {
      expiresIn: this.s.urlExpireSeconds,
    })
  }

  private ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.s.bucket }))
      } catch {
        await this.client.send(new CreateBucketCommand({ Bucket: this.s.bucket }))
      }
    })().catch((err) => {
      this.bucketReady = undefined // try again next time
      throw err
    })
    return this.bucketReady
  }
}
