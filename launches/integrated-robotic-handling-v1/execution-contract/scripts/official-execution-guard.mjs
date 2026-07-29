const forbiddenEnvironment = [
  "NODE_OPTIONS",
  "NODE_PATH",
];

const forbiddenExecArgument = /^(?:-r|--require|--import|--loader|--experimental-loader)(?:=|$)/;

const contaminatedEnvironment = forbiddenEnvironment.filter(
  (name) => typeof process.env[name] === "string" && process.env[name].length > 0,
);
const injectedExecArguments = process.execArgv.filter((value) =>
  forbiddenExecArgument.test(value)
);

if (contaminatedEnvironment.length > 0 || injectedExecArguments.length > 0) {
  throw new Error(
    [
      "Official frozen execution refuses Node preload or external module search injection.",
      contaminatedEnvironment.length > 0
        ? `Unset: ${contaminatedEnvironment.join(", ")}.`
        : "",
      injectedExecArguments.length > 0
        ? `Remove Node arguments: ${injectedExecArguments.join(", ")}.`
        : "",
    ].filter(Boolean).join(" "),
  );
}
