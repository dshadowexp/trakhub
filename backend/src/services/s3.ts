import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { config } from '../config';

export class S3Service {
    private client: S3Client;
    private bucket: string;

    constructor() {
        this.client = new S3Client({
            region: config.s3.region,
            credentials: {
                accessKeyId: config.s3.accessKeyId,
                secretAccessKey: config.s3.secretAccessKey
            },
        });
        this.bucket = process.env.AWS_S3_BUCKET!;
    }

    async uploadStream(stream: Readable, key: string, contentType?: string): Promise<string> {
        const upload = new Upload({
            client: this.client,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: stream,
                ContentType: contentType,
            },
        });

        await upload.done();
        return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }

    async uploadBuffer(buffer: Buffer, key: string, contentType?: string): Promise<string> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: contentType,
            })
        );

        return `https://${this.bucket}.s3.amazonaws.com/${key}`;
    }

    async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
        const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
        });

        return await getSignedUrl(this.client, command, { expiresIn });
    }

    async deleteFile(key: string): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: key,
            })
        );
    }
}

export const s3Service = new S3Service();