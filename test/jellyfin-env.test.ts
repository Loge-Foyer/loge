import { describe, expect, it } from 'vitest';

import { deriveServerUrl, parseEnv } from '../scripts/jellyfin-env.mjs';

describe('the local server file', () => {
  it('reads keys and values, ignoring comments, blanks and quotes', () => {
    expect(parseEnv('# server\nip=192.168.1.20\n\nweb_ui="http://192.168.1.20:8096"\nexport username=alex\npassword=a=b\n')).toEqual({
      ip: '192.168.1.20',
      web_ui: 'http://192.168.1.20:8096',
      username: 'alex',
      password: 'a=b',
    });
  });

  it('turns the web client address into the API base', () => {
    expect(deriveServerUrl({ web_ui: 'http://192.168.1.20:8096' })).toBe('http://192.168.1.20:8096');
    expect(deriveServerUrl({ web_ui: 'http://192.168.1.20:8096/web/#/home.html' })).toBe('http://192.168.1.20:8096');
    expect(deriveServerUrl({ web_ui: 'https://media.example.org/jellyfin/web/' })).toBe('https://media.example.org/jellyfin');
    expect(deriveServerUrl({ web_ui: '192.168.1.20:8096' })).toBe('http://192.168.1.20:8096');
  });

  it('falls back to the IP on the default port', () => {
    expect(deriveServerUrl({ ip: '192.168.1.20' })).toBe('http://192.168.1.20:8096');
    expect(deriveServerUrl({ ip: '192.168.1.20:8920' })).toBe('http://192.168.1.20:8920');
    expect(deriveServerUrl({})).toBeUndefined();
  });
});
