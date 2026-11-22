// Minimal WebSocket framing for the agent channel (text frames only).
// Server side decodes masked client frames; client side (mock/smoke) mirrors it.
import {createHash, randomBytes} from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 8 * 1024 * 1024;

export const acceptKey = key =>
  createHash('sha1').update(String(key) + GUID).digest('base64');

export function encodeFrame(payload, {opcode = 0x1, mask = false} = {}) {
  const data = Buffer.from(payload);
  const length = data.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  if (!mask) return Buffer.concat([header, data]);
  header[1] |= 0x80;
  const key = randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i += 1) masked[i] ^= key[i & 3];
  return Buffer.concat([header, key, masked]);
}

export const encodeText = (text, mask = false) => encodeFrame(text, {opcode: 0x1, mask});
export const encodeClose = (code = 1000, mask = false) => {
  const body = Buffer.alloc(2);
  body.writeUInt16BE(code, 0);
  return encodeFrame(body, {opcode: 0x8, mask});
};

/** Incremental frame reader; calls onFrame({opcode, data}) for each complete frame. */
export function createReader(onFrame) {
  let buffer = Buffer.alloc(0);
  return function read(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) throw new Error('WebSocket 帧过大');
        length = Number(big);
        offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        maskKey = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      const data = Buffer.from(buffer.subarray(offset, offset + length));
      if (maskKey) for (let i = 0; i < data.length; i += 1) data[i] ^= maskKey[i & 3];
      buffer = buffer.subarray(offset + length);
      onFrame({opcode, data});
    }
  };
}
