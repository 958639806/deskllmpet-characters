// A detached Windows GUI may inherit a console pipe whose parent has exited.
// Losing that diagnostic stream must not crash the desktop application.
for (const stream of [process.stdout, process.stderr]) {
  if (stream && typeof stream.on === 'function') stream.on('error', () => {});
}
