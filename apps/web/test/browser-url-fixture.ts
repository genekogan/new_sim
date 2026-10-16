// Modules such as world-path read the current URL during import. Unit tests
// run outside a browser; give them a URL without adding a DOM or doing I/O.
if (!('location' in globalThis)) {
  Object.defineProperty(globalThis, 'location', {
    value: new URL('http://fixture.invalid/w/eden/'),
    configurable: true,
    writable: true,
  });
}
