// Define protocol



/**
 * 
 * 
 * What the Server side sends
 * <oid> <refname>\0<capabilities>\n
 * <oid> <refname>\n
 * 0000
 * 
 * Client sends
 * want <oid>\n
 * have <oid>\n
 * done\n
 * 
 * Everything is framed using pkt-line encoding
 * pkt-line format - LLLL<data> where LLLL Buffer.from(length.toString(16).padStart(4, "0"))
 */
import { spawn, type ChildProcess } from 'child_process';
import { Readable, Writable, PassThrough } from 'stream';
import { Protocol } from "./protocol";
import { NULL_OID } from '../types';
import { Singleton } from '../repo/-shared';
import type { TRepository } from '../repo/repository';

const REF_LINE = /^([0-9a-f]+) (.*)$/

@Singleton
export class RemoteAgent {
    private _conn: Protocol | undefined;
    private _input: Readable;
    private _output: Writable;
    private _process?: ChildProcess;
    private _remoteRefs: Record<string, string> = {};

    constructor(private _repo: TRepository,  input?: Readable, output?: Writable) {
        this._input = input || new PassThrough();
        this._output = output || new PassThrough();
    }

    get conn(): Protocol | undefined {
        return this._conn;
    }

    get remoteRefs(): Record<string, string> {
        return this._remoteRefs;
    }

    acceptClient(name: string, capabilities: string[] = []) {
        this._conn = new Protocol(name, this._input, this._output, capabilities);
    }

    async startAgent(name: string, program: string, url: string, capabilities: string[] = []) {
        const parsedUrl = new URL(url);
        
        // For HTTP/HTTPS URLs, use fetch-based streaming
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
            
            await this._startHttpAgent(name, parsedUrl, capabilities);
        } else {
            // For git:// or ssh:// protocols, use child process
            await this._startProcessAgent(name, program, url, capabilities);
        }
    }

    async sendReferences() {
        const refs = await this._repo.refs.listAllRefs();
        let sent = false;

        const sortedRefs = refs.sort((a, b) => a.path.localeCompare(b.path));

        for (const symref of sortedRefs) {
            const oid = await symref.readHash();
            if (!oid) continue;

            this._conn?.sendPktLine(`${ oid.toLowerCase() } ${ symref.path }`);
            sent = true;
        }

        if (!sent) {
            this._conn?.sendPktLine(`${ NULL_OID } capabilities^{}`);
        }

        this._conn?.sendPktLine(null);
    }

    async recvReferences() {
        this._remoteRefs = {};

        for await (const line of this._conn!.recvUntil(null)) { //check the nil terminator
            const match = line.match(REF_LINE);
            if (!match) continue;

            const [, oid, ref] = match;
            
            if (oid !== NULL_OID) {
                this._remoteRefs[ref] = oid.toLowerCase();
            }
        }
    }

    private async _startHttpAgent(name: string, parsedUrl: URL, capabilities: string[] = []) {        
        // Construct the Git HTTP URL
        // For upload-pack (fetch): GET /repo.git/info/refs?service=git-upload-pack
        // For receive-pack (push): GET /repo.git/info/refs?service=git-receive-pack
        const service = name === 'fetch' ? 'git-upload-pack' : 'git-receive-pack';
        const infoRefsUrl = `${parsedUrl.origin}${parsedUrl.pathname}/info/refs?service=${service}`;
        console.log(infoRefsUrl);
        
        try {
            // Phase 1: Get refs advertisement
            const response = await fetch(infoRefsUrl, {
                headers: {
                    'User-Agent': 'git/trak-1.0',
                    'Accept': '*/*'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            console.log(response.body);

            // Create streams from the response
            this._input = Readable.fromWeb(response.body as any);
            this._output = new PassThrough();

            // Set up protocol connection
            this._conn = new Protocol(name, this._input, this._output, capabilities);

            // For subsequent requests (actual pack data exchange), we need to POST
            this._setupHttpPostStream(parsedUrl, service);
        } catch (error) {
            throw new Error(`Failed to connect to remote: ${(error as Error).message}`);
        }
    }

    private _setupHttpPostStream(parsedUrl: URL, service: string) {
        const postUrl = `${parsedUrl.origin}${parsedUrl.pathname}/${service}`;
    
        // Make sure _input is a PassThrough so we can push to it
        if (!(this._input instanceof PassThrough)) {
            const passThrough = new PassThrough();
            this._input = passThrough;
        }
    
        this._output.on('data', async (chunk: Buffer) => {
            try {
                const response = await fetch(postUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': `application/x-${service}-request`,
                        'Accept': `application/x-${service}-result`,
                        'User-Agent': 'git/trak-1.0'
                    },
                    body: chunk
                });
    
                if (!response.ok) {
                    throw new Error(`HTTP ${ response.status }: ${ response.statusText }`);
                }
    
                // Push response data into input stream
                const arrayBuffer = await response.arrayBuffer();
                const responseBuffer = Buffer.from(arrayBuffer);
                (this._input as PassThrough).push(responseBuffer);
    
            } catch (error) {
                this._output.emit('error', error);
            }
        });
    }

    private async _startProcessAgent(name: string, program: string, url: string, capabilities: string[] = []) {
        const command = this._buildAgentCommand(program, url);
        
        // Spawn the process
        this._process = spawn(command[0], command.slice(1), {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        if (!this._process.stdin || !this._process.stdout) {
            throw new Error('Failed to create process streams');
        }

        this._input = this._process.stdout;
        this._output = this._process.stdin;

        // Set up protocol connection
        this._conn = new Protocol(name, this._input, this._output, capabilities);

        // Handle process errors
        this._process.on('error', (error) => {
            throw new Error(`Process error: ${error.message}`);
        });

        this._process.stderr?.on('data', (data) => {
            console.error(`Process stderr: ${data.toString()}`);
        });
    }

    private _buildAgentCommand(program: string, url: string): string[] {
        const parsedUrl = new URL(url);
        const programParts = program.split(' ');
        return [...programParts, parsedUrl.pathname];
    }

    close() {
        if (this._process) {
            this._process.kill();
        }
        
        if (this._input && 'destroy' in this._input) {
            (this._input as any).destroy();
        }
        
        if (this._output && 'destroy' in this._output) {
            (this._output as any).destroy();
        }
    }
}