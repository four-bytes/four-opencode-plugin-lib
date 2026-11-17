import { Fragment, jsx, jsxs } from "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime";
import { ProgressBar } from "./progress-bar";

export interface TokenMeterProps {
  tokens: number;
  softLimit: number;
}

export function TokenMeter(props: TokenMeterProps) {
  return jsx(Fragment, {
    get children() {
      return [
        jsxs("text", {
          get children() {
            return [jsx("b", { get children() { return "Tokens 📊"; } })];
          },
        }),
        jsx(ProgressBar, {
          get current() {
            return props.tokens;
          },
          get total() {
            return props.softLimit;
          },
        }),
      ];
    },
  });
}
