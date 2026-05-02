async function globalTeardown(): Promise<void> {
  await globalThis.__lumencastE2EDevServer?.close();
}

export default globalTeardown;
