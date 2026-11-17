// Ambient declarations for OpenCode's TUI host runtime modules.
//
// TUI plugins are installed under `node_modules`, where OpenTUI's Solid JSX
// transform is deliberately skipped, so bare JSX would be compiled with Bun's
// default React runtime and fail. Importing these host singletons through the
// virtual `opentui:runtime-module:*` ids keeps consumers on the host's module
// instances from any install location. The ids only exist inside the OpenCode
// TUI process, so declare them for type-checking without pulling in the peers.

declare module "opentui:runtime-module:solid-js"
declare module "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime"
