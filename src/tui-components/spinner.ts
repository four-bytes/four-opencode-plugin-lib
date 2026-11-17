import { createSignal, onMount, onCleanup } from "opentui:runtime-module:solid-js";
import { jsx } from "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime";
import type { RGBA } from "@opentui/core";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DEFAULT_INTERVAL = 80;

export interface SpinnerProps {
  interval?: number;
  fg?: string | RGBA;
}

export function Spinner(props: SpinnerProps) {
  const [frame, setFrame] = createSignal(0);

  onMount(() => {
    const timer = setInterval(
      () => setFrame((f: number) => (f + 1) % FRAMES.length),
      props.interval ?? DEFAULT_INTERVAL,
    );
    onCleanup(() => clearInterval(timer));
  });

  return jsx("text", {
    get fg() {
      return props.fg;
    },
    get children() {
      return FRAMES[frame()];
    },
  });
}
