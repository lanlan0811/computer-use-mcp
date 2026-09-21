/**
 * Worker protocol contract: NDJSON framing, version gating, and error-code
 * coverage. Pure logic — no FFI, so it runs everywhere including ubuntu CI.
 */

import { describe, expect, it } from 'vitest';

import {
  PROTOCOL_VERSION,
  LineFramer,
  ProtocolError,
  decodeRequest,
  encodeResponse,
  errorResponse,
  okResponse,
} from '../../src/worker/protocol.js';

describe('decodeRequest', () => {
  it('accepts a well-formed request', () => {
    const req = decodeRequest(
      JSON.stringify({ v: 1, id: 7, action: 'click', payload: { x: 1, y: 2 } }),
    );
    expect(req).toEqual({
      v: 1,
      id: 7,
      action: 'click',
      payload: { x: 1, y: 2 },
      timeoutMs: undefined,
    });
  });

  it('accepts a request without payload and timeout', () => {
    const req = decodeRequest(JSON.stringify({ v: 1, id: 0, action: 'ping' }));
    expect(req.payload).toBeUndefined();
    expect(req.timeoutMs).toBeUndefined();
  });

  it('rejects a wrong protocol version', () => {
    expect(() =>
      decodeRequest(JSON.stringify({ v: 2, id: 1, action: 'ping' })),
    ).toThrow(ProtocolError);
  });

  it('rejects non-JSON lines', () => {
    expect(() => decodeRequest('not json')).toThrow(ProtocolError);
  });

  it('rejects non-object frames', () => {
    expect(() => decodeRequest('[1,2,3]')).toThrow(ProtocolError);
  });

  it('rejects bad ids and actions', () => {
    expect(() =>
      decodeRequest(JSON.stringify({ v: 1, id: 'x', action: 'ping' })),
    ).toThrow(ProtocolError);
    expect(() =>
      decodeRequest(JSON.stringify({ v: 1, id: 1, action: '' })),
    ).toThrow(ProtocolError);
    expect(() =>
      decodeRequest(
        JSON.stringify({ v: 1, id: 1, action: 'ping', payload: 5 }),
      ),
    ).toThrow(ProtocolError);
  });
});

describe('response encoding', () => {
  it('round-trips ok responses as one line', () => {
    const line = encodeResponse(okResponse(3, { x: 1 }));
    expect(line.includes('\n')).toBe(false);
    expect(JSON.parse(line)).toEqual({
      v: PROTOCOL_VERSION,
      id: 3,
      ok: true,
      result: { x: 1 },
    });
  });

  it('round-trips error responses with a machine code', () => {
    const line = encodeResponse(
      errorResponse(4, 'user_interference_result_unknown', 'boom'),
    );
    expect(JSON.parse(line)).toEqual({
      v: PROTOCOL_VERSION,
      id: 4,
      ok: false,
      error: { code: 'user_interference_result_unknown', message: 'boom' },
    });
  });
});

describe('LineFramer', () => {
  it('splits chunks on newlines and keeps the remainder', () => {
    const framer = new LineFramer();
    expect(framer.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(framer.pending).toBe('{"b"');
    expect(framer.push(':2}\n')).toEqual(['{"b":2}']);
    expect(framer.pending).toBe('');
  });

  it('tolerates CRLF line endings', () => {
    const framer = new LineFramer();
    expect(framer.push('one\r\ntwo\r\n')).toEqual(['one', 'two']);
  });

  it('ignores blank lines', () => {
    const framer = new LineFramer();
    expect(framer.push('\n\n')).toEqual([]);
  });
});
