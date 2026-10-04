import { describe, expect, it } from 'vitest';
import { describeError, isInvalidKey, isUnauthorized } from '../../src/errors';

describe('describeError', () => {
  it('names the missing role and claim for each operation', () => {
    const err = { code: 'UnauthorizedAccess', message: 'Unauthorized access.' };
    expect(describeError(err, 'peek')).toContain('Azure Service Bus Data Receiver');
    expect(describeError(err, 'send')).toContain('Azure Service Bus Data Sender');
    expect(describeError(err, 'list')).toContain('Manage claim');
    expect(describeError(err, 'receive')).toContain('(Unauthorized access.)');
  });

  it('treats HTTP 401 and 403 as missing permissions', () => {
    expect(describeError({ statusCode: 401, message: 'no' }, 'list')).toContain('Not authorized to list');
    expect(describeError({ statusCode: 403, message: 'no' }, 'list')).toContain('Not authorized to list');
  });

  it('tells a wrong key apart from a missing claim', () => {
    const wrongKey = { statusCode: 401, message: 'SubCode=40103: Invalid authorization token signature' };
    expect(describeError(wrongKey, 'list')).toContain('key or key name of the connection string is not valid');
    const missingClaim = { statusCode: 401, message: 'SubCode=40100: Unauthorized : Manage claim is required' };
    expect(describeError(missingClaim, 'list')).toContain('Not authorized to list');
    expect(isInvalidKey(wrongKey)).toBe(true);
    expect(isInvalidKey({ errors: [wrongKey] })).toBe(true);
    expect(isInvalidKey(missingClaim)).toBe(false);
  });

  it('unwraps the last attempt of an exhausted retry', () => {
    const aggregate = { message: '', errors: [{ message: 'first' }, { code: 'UnauthorizedAccess', message: 'last' }] };
    expect(describeError(aggregate, 'send')).toContain('Not authorized to send');
    expect(describeError(aggregate, 'send')).toContain('(last)');
  });

  it('suggests WebSockets when the namespace cannot be reached', () => {
    expect(describeError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }, 'peek')).toContain('Use Web Sockets');
  });

  it('keeps only the first line of other errors', () => {
    expect(describeError(new Error('Queue not found.\nTrackingId: 123'), 'peek')).toBe('Queue not found.');
  });

  it('drops the tracking data Service Bus appends', () => {
    const message =
      'InvalidSignature: The token has an invalid signature. TrackingId:e2faf254-e567_G8, SystemTracker:ns.servicebus.windows.net:$Resources/Queues, Timestamp:2026-10-04T08:31:49';
    expect(describeError({ statusCode: 401, message }, 'list')).toBe(
      'The key or key name of the connection string is not valid. Check that it was copied in full. (InvalidSignature: The token has an invalid signature.)',
    );
    expect(describeError(new Error("The messaging entity 'x' could not be found.  TrackingId:41_G0, SystemTracker:gateway1"), 'peek')).toBe(
      "The messaging entity 'x' could not be found.",
    );
  });

  it('never returns an empty text', () => {
    expect(describeError({ message: '', code: 'Weird' }, 'peek')).toBe('Unexpected error (Weird).');
    expect(describeError(undefined, 'peek')).not.toBe('');
  });
});

describe('isUnauthorized', () => {
  it('recognises authorization failures, also inside an AggregateError', () => {
    expect(isUnauthorized({ code: 'UnauthorizedAccess' })).toBe(true);
    expect(isUnauthorized({ statusCode: 403 })).toBe(true);
    expect(isUnauthorized({ errors: [{ statusCode: 401 }] })).toBe(true);
  });

  it('is false for anything else', () => {
    expect(isUnauthorized({ code: 'ENOTFOUND' })).toBe(false);
    expect(isUnauthorized(undefined)).toBe(false);
  });
});
