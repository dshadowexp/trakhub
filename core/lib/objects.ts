import { createHash } from 'crypto';
import type { Entry } from './types';

export class TrakObject {
    protected _type: string;
    protected _content: Buffer;

    constructor(objType: string, data: Buffer = Buffer.from('')) {
        this._type = objType;
        this._content = data;
    }

    get type(): string | undefined {
        return this._type;
    }

    get content(): Buffer {
        return this._content;
    }

    hash(): string {
        const header = Buffer.from(`${this._type} ${this._content.byteLength}\0`);
        const hash = createHash('sha1');
        hash.update(Buffer.concat([header, this._content]));
        return hash.digest('hex');
    }

    serialize(): Buffer {
        throw new Error('rawise not implemented');
    };
}

export class TrakBlob extends TrakObject {
    constructor(data: Buffer) {
        super("blob", data);
    }

    serialize(): Buffer {
        return this._content;
    }

    static deserialize(content: Buffer): TrakBlob {
        return new TrakBlob(content);
    }
}

export class TrakTree extends TrakObject {
    constructor(private _entries: Entry[] = []) {
        super("tree");
        this._content = this.serialize();
    }

    get entries(): Entry[] {
        return this._entries;
    }

    async addEntry(entry: Entry) {
        this._entries.push(entry);
        this._content = this.serialize();
    }

    serialize(): Buffer {
        return Buffer.concat(this._entries.sort((a, b) => a.name.localeCompare(b.name)).map((entry) => {
            return Buffer.concat([Buffer.from(`${ entry.mode } ${ entry.name }\0`), Buffer.from(entry.oid, 'hex')])
        }));
    }

    static deserialize(content: Buffer): TrakTree {
        // Initialize tree
        const tree = new TrakTree();
        let i = 0;

        while (i < content.length) {
            // Find index of null byte
            const nullIdx = content.indexOf(0, i);
            // Exit loop if null byte is absent from rest of content
            if (nullIdx === -1)
                break

            // Extract mode, name, and oid of current entry
            const [mode, name] = content.subarray(i, nullIdx).toString().split(" ");
            const oid = content.subarray(nullIdx + 1, nullIdx + 21).toString('hex');
            // Add entry to tree
            tree.addEntry({mode, name, oid});
            
            i = nullIdx + 21;
        }

        return tree;
    }
}

export class Author {
    constructor(private _name: string, private _email: string, private _timestamp: number = 0) {
        this._timestamp = this._timestamp == 0 ? this._initTimestamp() : this._timestamp;
    }

    get timestamp(): number {
        return this._timestamp;
    }

    private _initTimestamp(): number {
        return Math.floor((new Date()).getTime() / 1000);
    }

    serialize(): string {
        return `${ this._name } <${ this._email }>`;
    }
}

export class TrakCommit extends TrakObject {
    private _timezone: string;

    constructor(
        private _treeHash: string, 
        private _parentHashes: string[], 
        private _author: Author, 
        private _committer: Author,
        private _message: string,
    ) {
        super("commit");
        this._content = this.serialize();
        this._timezone = this._setTimezone(new Date());
    }

    get treeHash(): string {
        return this._treeHash;
    }

    get parentHashes(): string[] {
        return this._parentHashes;
    }

    get author(): Author {
        return this._author;
    }

    get committer(): Author {
        return this._committer;
    }

    get timezone(): string {
        return this._timezone;
    }

    get message(): string {
        return this._message;
    }

    private _setTimezone(date: Date): string {
        const offset = -date.getTimezoneOffset();
        const hours = Math.floor(Math.abs(offset) / 60);
        const minutes = Math.abs(offset) % 60;
        const sign = offset >= 0 ? '+' : '-';
        return `${sign}${String(hours).padStart(2, '0')}${String(minutes).padStart(2, '0')}`;
    }

    serialize(): Buffer {
        const lines = [`tree ${this._treeHash}`];
        for (const parent of this._parentHashes) {
            lines.push(`parent ${ parent }`);
        }

        lines.push(`author ${ this._author.serialize() } ${ this._author.timestamp } ${ this._timezone }`);
        lines.push(`committer ${ this._committer.serialize() } ${ this._author.timestamp } ${ this._timezone }`);
        lines.push("");
        lines.push(this._message);

        // Convert to Buffer
        return Buffer.from(lines.join("\n"));
    }

    static deserialize(content: Buffer): TrakCommit {
        // Splits content by new line
        const lines = content.toString().split('\n');
        let treeHash = null, 
            parentHashes: string[] = [], 
            author: Author | null = null, 
            committer: Author | null = null, 
            timestamp: number | null = null,
            message_start = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith("tree")) {
                treeHash = line.substring(5);
            } else if (line.startsWith("parent ")) {
                parentHashes.push(line.substring(7));
            } else if (line.startsWith("author ")) {
                const parsed = this._unwrapAuthorLine(line.substring(7));
                author = parsed[0];
                timestamp = parsed[1];
            } else if (line.startsWith("committer ")) {
                committer = this._unwrapAuthorLine(line.substring(10))[0];
            } else if (line === "") {
                message_start = i + 1;
                break;
            }
        }

        const message = lines.splice(message_start).join('\n');
        return new TrakCommit(treeHash!, parentHashes, author!, committer!, message);
    }

    private static _unwrapAuthorLine(content: string): [Author, number] {
        // Find last space (before timezone)
        const lastSpace = content.lastIndexOf(' ');
        const timezone = content.substring(lastSpace + 1);
        
        // Find second-to-last space (before timestamp)
        const secondLastSpace = content.lastIndexOf(' ', lastSpace - 1);
        const timestamp = parseInt(content.substring(secondLastSpace + 1, lastSpace), 10);
        
        // Everything before is the author
        const author = content.substring(0, secondLastSpace).split(' ');
        const name = author.slice(0, -1).join(' ');
        const email = author[author.length - 1].substring(1, author[author.length - 1].length - 1);

        return [new Author(name, email), timestamp];
    }
}