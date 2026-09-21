// stdio MCP server entry point.
//
// Phase 1 scaffold: the full server (tool registry, dispatch, gates) lands in
// Phase 4. This stub exists so the toolchain (typecheck, build) has an entry
// point and the published `bin` resolves.
//
// stdout is reserved for the MCP protocol; all diagnostics go to stderr.

process.stderr.write(
  'computer-use: server not implemented yet (Phase 1 scaffold)\n',
);
process.exitCode = 1;
