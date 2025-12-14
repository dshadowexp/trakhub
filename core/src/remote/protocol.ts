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

import type { Readable, Writable } from "stream";
import { NULL_BYTE } from "../types";
import { intersection } from "../util";

class Protocol {
    private _localCapabilities: string[] = [];
    private _remoteCapabilities: string[] = [];
    private _capabilitiesSent: boolean;

    constructor(private _command: string, private _input: Readable, private _outPut: Writable, _capabilities: string[] = []) {
        this._localCapabilities = _capabilities;
        this._capabilitiesSent = false;
    } 

    isCapable(ability: string): boolean {
        return this._localCapabilities.includes(ability);
    }

    sendPktLine(line: string | Buffer | null) {
        if (!line) {
            this._outPut.write(this._pktFlush());
            return;
        }

        this._outPut.write(this._encodePktLine(this._appendCaps(line)));
    }

    *recvUntil(terminator: string): Generator<string> {
        while (true) {
            const line = this.recvPkt();
    
            // A flush packet (0000), which recvPkt returns as an empty buffer,
            // is a common terminator for pkt-line sequences.
            if (line.length === 0) {
                break;
            }
    
            const lineStr = line.toString('utf-8');
    
            // Also break if we receive the specific terminator string.
            if (lineStr === terminator) {
                break;
            }
    
            yield lineStr;
        }
    }

    recvPkt() {
        const head = this._input.read(4);
        if (!/^[0-9a-f]{4}$/i.test(head.toString())) {
            return head;
        }

        const length = parseInt(head.toString(), 16);
        if (length === 0) {
            return Buffer.alloc(0);
        }

        const line = this._input.read(length - 4);
        if (line.length > 0 && line[line.length - 1] === 10) {
            return line.subarray(0, line.length - 1);
        }

        return this._detectCaps(line);
    }

    _appendCaps(line: string | Buffer) {
        if (this._capabilitiesSent) {
            return line;
        }

        this._capabilitiesSent = true;
        const sep = this._command === "fetch" ? " " : NULL_BYTE

        let caps = [ ...this._localCapabilities ];
        if (this._remoteCapabilities.length > 0)
            caps = intersection(caps, this._remoteCapabilities);

        return `${ line }${ sep }${ caps.join(" ") }`;
    }

    _encodePktLine(data: string | Buffer): Buffer {
        const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const length = payload.byteLength + 5;
        const header = Buffer.from(length.toString(16).padStart(4, "0"))
        return Buffer.concat([header, payload, Buffer.from("\n")]);
    }

    _pktFlush(): Buffer {
        return Buffer.from("0000");
    }

    _detectCaps(line: Buffer) {
        if (this._remoteCapabilities.length > 0) {
            return line;
        }

        const isFetch = this._command !== "upload-pack";
        const sep = isFetch ? NULL_BYTE : " ";
        const n = isFetch ? 2 : 3;

        const allParts = line.toString('utf-8').split(sep);
        let parts: string[];
        if (allParts.length > n) {
            const head = allParts.slice(0, n - 1);
            const tail = allParts.slice(n - 1).join(sep);
            parts = [...head, tail];
        } else {
            parts = allParts;
        }

        let capsLine = "";
        if (parts.length === n) {
            capsLine = parts.pop() || "";
        }

        this._remoteCapabilities = capsLine ? capsLine.split(' ') : [];
        return parts.join(" ");
    }
}