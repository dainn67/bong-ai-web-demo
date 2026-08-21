import { describe, expect, it } from 'vitest';
import { buildSocketUrl } from './ota-client';
import { DEFAULT_CONFIG } from '../config/device-config';

const config = { ...DEFAULT_CONFIG, macAddress: 'aa:bb:cc:dd:ee:ff' };

describe('buildSocketUrl', () => {
  it('sends the device id under both spellings the gateway accepts', () => {
    const url = new URL(buildSocketUrl('ws://localhost:8000/xiaozhi/v1/', config, 'tok'));

    expect(url.searchParams.get('device-id')).toBe('aa:bb:cc:dd:ee:ff');
    expect(url.searchParams.get('device_id')).toBe('aa:bb:cc:dd:ee:ff');
    expect(url.searchParams.get('token')).toBe('tok');
  });

  it('appends to a URL that already has a query string', () => {
    const url = buildSocketUrl('ws://host/path?foo=1', config, 'tok');

    expect(url).toContain('?foo=1&');
    expect(new URL(url).searchParams.get('foo')).toBe('1');
  });

  it('omits the token when OTA did not issue one', () => {
    const url = new URL(buildSocketUrl('ws://localhost:8000/', config, ''));

    // An empty `token=` reads as a real, empty credential to some gateways and
    // gets rejected — better to leave the parameter out entirely.
    expect(url.searchParams.has('token')).toBe(false);
  });
});
