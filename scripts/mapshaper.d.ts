/**
 * Minimal typings for mapshaper, which ships none of its own.
 *
 * Only the one entry point the sync pipeline uses is declared.
 */
declare module 'mapshaper' {
  /**
   * Run a mapshaper command string against in-memory files.
   *
   * @param commands the command line, as it would be typed for the mapshaper CLI
   * @param input files the commands can read, keyed by the name used in the command
   * @returns the files the commands wrote, keyed by output name
   */
  export function applyCommands(
    commands: string,
    input: Record<string, Uint8Array | string>,
  ): Promise<Record<string, Uint8Array>>;

  const mapshaper: { applyCommands: typeof applyCommands };
  export default mapshaper;
}
