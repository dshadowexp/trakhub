import { createHash, type Hash } from "crypto";
import { Readable, Writable } from "stream";
import { createDeflate, createInflate, constants } from "zlib";
import { TObject, TObjects, TObjectType } from "../repo/objects";
import type { TRepository } from "../repo/repository";

export const HEADER_SIGNATURE = "PACK";
const HEADER_SIZE = 12;
const VERSION: number = 2;
const SEEK_SET = 0;
const ZLIB_DEFAULT_COMPRESSION = constants.Z_DEFAULT_COMPRESSION;

const PackFileObjectType = {
    COMMIT: 1,
    TREE: 2,
    BLOB: 3,
} as const;

type PackFileObjectType = typeof PackFileObjectType[keyof typeof PackFileObjectType];

type PackEntry = { oid: string, type: PackFileObjectType }

interface PackWriterOptions {
    compression?: number;
}

export class PackWriter {
    private _packList: PackEntry[];
    private _hash: Hash;
    private _compression: number;

    constructor(private _repo: TRepository, private _outPut: Writable, options: PackWriterOptions = {}) {
        this._packList = []
        this._hash = createHash('sha1');
        this._compression = options.compression || ZLIB_DEFAULT_COMPRESSION;
    }

    async writeObjects(revList: TObject[]) {
        this._preparePackList(revList);
        this._writeHeader();
        await this._writeEntries();
        this._outPut.write(Buffer.from(this._hash.digest('hex')));
    }

    _preparePackList(revList: TObject[]) {
        revList.forEach((object) => {
            this._addToPackList(object);
        });
    }

    _addToPackList(object: TObject) {
        switch(object.type) {
            case TObjectType.COMMIT:
                this._packList.push({ oid: object.hash!, type: PackFileObjectType.COMMIT });
                break;
            case TObjectType.TREE:
            case TObjectType.BLOB:
                const type = object.type === TObjectType.TREE ? PackFileObjectType.TREE : PackFileObjectType.BLOB;
                this._packList.push({ oid: object.hash!, type: type });
                break;
            default:
                throw new Error(`Unknown object type for packing: ${object.type}`); 
        }
    }

    _writeHeader() {
        const header = Buffer.alloc(HEADER_SIZE);
        header.write(HEADER_SIGNATURE, 0, 4, 'ascii');
        header.writeUInt32BE(VERSION, 4);
        header.writeUInt32BE(this._packList.length, 8);
        this._write(header);
    }

    async _writeEntries() {
        await Promise.all(this._packList.map(async (entry) => this._writeEntry(entry)));
    }

    async _writeEntry(entry: PackEntry) {
        const { type: typeStr, size, data } = await this._repo.objects.loadRaw(entry.oid);
        const typeMap: { [key: string]: number } = {
            [TObjectType.COMMIT]: PackFileObjectType.COMMIT,
            [TObjectType.TREE]: PackFileObjectType.TREE,
            [TObjectType.BLOB]: PackFileObjectType.BLOB,
        };
        const type = typeMap[typeStr];
        if (type === undefined) {
            throw new Error(`Unknown object type for packing: ${typeStr}`);
        }

        const header = this._varIntLEWrite(size, type);
        const compressedData = await this._deflateBuffer(data);

        this._write(header);
        this._write(compressedData)
    }

    _write(data: Buffer) {
        this._outPut.write(data);
        this._hash.update(data);
    }

    _deflateBuffer(data: Buffer): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const deflater = createDeflate({ level: this._compression });
            const chunks: Buffer[] = [];
        
            deflater.on("data", c => chunks.push(c));
            deflater.on("end", () => resolve(Buffer.concat(chunks)));
            deflater.on("error", reject);
        
            deflater.end(data);
        });
    }

    _varIntLEWrite(size: number, type: number) {
        const headerParts: number[] = [];
        let s = size;
        let byte0 = (type << 4) | (s & 0x0F);
        s >>= 4;

        if (s > 0) {
            byte0 |= 0x80; // Set the 'more' bit
        }
        headerParts.push(byte0);

        while (s > 0) {
            let nextByte = s & 0x7F;
            s >>= 7;

            if (s > 0) {
                nextByte |= 0x80;
            }
            headerParts.push(nextByte);
        }
        return Buffer.from(headerParts);
    }
}

export class PackReader {
    private _count: number;
    private _stream: PackStreamReader;

    constructor(private _repo: TRepository, private _inPut: PackStreamReader) {
        this._count = 0;
        this._stream = _inPut;
    }

    get count(): number {
        return this._count;
    }

    readHeader() {
        const data: Buffer | null = this._stream.read(HEADER_SIZE);

        if (!data || data.length < HEADER_SIZE) {
            throw new Error("Failed to read packfile header or header is incomplete.");
        }
        
        const signature = data.toString('ascii', 0, 4);
        const version = data.readUInt32BE(4);
        this._count = data.readUInt32BE(8);

        if (signature !== HEADER_SIGNATURE) {
            throw new Error(`Invalid packfile signature. Expected "PACK", got "${signature}".`);
        }

        if (version !== VERSION) {
            throw new Error(`Unsupported packfile version: ${version}. Trak supports version ${VERSION}.`);
        }
    }

    async readRecord() {
        const { type } = this._readRecordHeader();
        const data = await this._readZlibStream();

        const typeMap: { [key: number]: TObjectType } = {
            [PackFileObjectType.COMMIT]: TObjectType.COMMIT,
            [PackFileObjectType.TREE]: TObjectType.TREE,
            [PackFileObjectType.BLOB]: TObjectType.BLOB,
        };
        const typeStr = typeMap[type];
        if (typeStr === undefined) {
            throw new Error(`Unknown object type for packing: ${type}`);
        }

        return {
            type: typeStr,
            data
        };
    }

    private _readZlibStream(): Promise<Buffer> {
        const inflate = createInflate();
        const decompressedChunks: Buffer[] = [];
        const rawChunks: Buffer[] = [];
    
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this._stream.removeListener('readable', onReadable);
                inflate.removeListener('data', onData);
                inflate.removeListener('end', onEnd);
                inflate.removeListener('error', onError);
            };
    
            const onData = (chunk: Buffer) => {
                decompressedChunks.push(chunk);
            };
    
            const onError = (err: Error) => {
                cleanup();
                reject(err);
            };
    
            const onEnd = () => {
                cleanup();
    
                const totalRaw = Buffer.concat(rawChunks);
                const consumedBytes = inflate.bytesWritten;
    
                if (totalRaw.length > consumedBytes) {
                    const remainder = totalRaw.subarray(consumedBytes);
                    this._stream.unshift(remainder);
                }
                
                resolve(Buffer.concat(decompressedChunks));
            };
    
            const onReadable = () => {
                let chunk: Buffer | null;
                while ((chunk = this._stream.read()) !== null) {
                    rawChunks.push(chunk);
                    inflate.write(chunk);
                }
            };
    
            inflate.on('data', onData);
            inflate.on('end', onEnd);
            inflate.on('error', onError);
            this._stream.on('readable', onReadable);
    
            onReadable();
        });
    }

    private _readRecordHeader() {
        const [type, size] = this._varIntLERead();
        return { type, size };
    }

    private _varIntLERead(): [number, number] {
        let byte = this._stream.readByte();

        const type = (byte & 0x70) >> 4;
        let size = byte & 0x0F;
        let shift = 4;

        while ((byte & 0x80) !== 0) {
            byte = this._stream.readByte();
            size |= (byte & 0x7F) << shift;
            shift += 7;
        }
        
        return [type, size];
    }
}

export class PackStreamReader {
    private _hash: Hash;
    private _offset: number;
    private _stream: Readable;
    private _buffer: Buffer;
    private _capture: Buffer | null;

    constructor(input: Readable, buffer: Buffer = Buffer.alloc(0)) {
        this._stream = input;
        this._hash = createHash('sha1');
        this._offset = 0;
        this._buffer = Buffer.concat([this._newByteString(), buffer]);
        this._capture = null;
    }

    get offset(): number {
        return this._offset;
    }

    private _newByteString(): Buffer {
        return Buffer.alloc(0);
    }

    /**
     * Returns the hash of the data read so far.
     */
    digest(encoding: 'hex' | 'buffer' = 'buffer'): string | Buffer {
        // Use a conditional to help TypeScript resolve the correct
        // crypto.Hash.digest() overload.
        if (encoding === 'hex') {
            return this._hash.digest('hex');
        } else {
            // digest() with no arguments returns a Buffer.
            return this._hash.digest();
        }
    }

    /**
     * Executes a block of code and captures all bytes read during its execution.
     * The captured bytes are hashed in a single operation after the block completes.
     *
     * @param block A function that performs read operations. Can be async.
     * @returns A Promise that resolves to a tuple containing the block's return value
     *          and a Buffer of the captured data.
     */
    async capture<T>(block: () => T | Promise<T>): Promise<[T, Buffer]> {
        this._capture = this._newByteString(); // Start capturing
        try {
            const result = await Promise.resolve(block()); // This is the `yield`

            const capturedData = Buffer.concat([this._capture]);
            this._hash.update(capturedData); // Update hash with the whole chunk at once
            this._capture = null;

            return [result, capturedData];
        } catch (e) {
            // Ensure we clean up on error
            this._capture = null;
            throw e;
        } 
    }

    /**
     * 
     * 
     * @param amount 
     * @param whence 
     * @returns 
     */
    seek(amount: number, whence: number = SEEK_SET) {
        if (amount >= 0) return;
        const start = this._capture!.length + amount;

        if (start < 0)
            throw new Error("Negative seek offset")

        const data = this._capture?.subarray(start);
        // this._capture = this._capture?.subarray(0, start);
        // this._buffer.unshift(data);
        this._offset += amount;
    }

    /**
     * Reads data from the stream and updates the hash.
     */
    read(size?: number): Buffer | null {
        const data = this._stream.read(size);
        if (data) {
            this._hash.update(data);
            this._offset += data.length;
        }
        return data;
    }

    private _readBuffered(size: number, block: boolean = true): Buffer {
        const fromBuf = this._buffer.subarray(0, size);
        try {
            const needed = size - fromBuf.length;
            const fromIO = block ? this._stream.read(needed) : this._readNonBlock(needed);
            return Buffer.concat([fromBuf, fromIO || Buffer.alloc(0)]);
        } catch (error) {
            return fromBuf;
        } 
    }

    private _readNonBlock(size: number): Buffer {
        const data = this._readBuffered(size, false);
        this._updateState(data);
        return data;
    }

    _updateState(data: Buffer) {
        if (this._capture === null) {
            // If not capturing, update the main hash.
            this._hash.update(data);
        } else {
            // If capturing, add the data to the capture buffer.
            this._capture = Buffer.concat([this._capture, data]);
        }
    
        // Always update the total offset.
        this._offset += data.length;
    }

    /**
     * Reads a single byte from the stream.
     */
    readByte(): number {
        const buf = this.read(1);
        if (buf === null) {
            throw new Error("Unexpected end of input stream.");
        }
        return buf[0];
    }
    
    /**
     * Puts data back onto the stream. This does NOT affect the hash, as this
     * data is expected to be read again in a subsequent `read` call.
     */
    unshift(chunk: Buffer): void {
        this._stream.unshift(chunk);
    }
    
    /**
     * Verifies the checksum of the stream.
     */
    verifyChecksum() {
        const expectedChecksum = this._stream.read(20);
        const actualChecksum = this.digest('buffer') as Buffer;

        if (!expectedChecksum || !expectedChecksum.equals(actualChecksum)) {
            throw new Error("Packfile checksum mismatch.");
        }
    }

    /**
     * Attaches an event listener to the underlying stream.
     */
    on(event: string, listener: (...args: any[]) => void): this {
        this._stream.on(event, listener);
        return this;
    }

    /**
     * Removes an event listener from the underlying stream.
     */
    removeListener(event: string, listener: (...args: any[]) => void): this {
        this._stream.removeListener(event, listener);
        return this;
    }

    
}