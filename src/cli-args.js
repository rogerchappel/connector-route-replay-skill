const COMMANDS = {
  replay: new Set(["--format", "--policy"]),
  verify: new Set(["--policy"])
};

const OPTION_NAMES = new Set(["--format", "--policy"]);

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseCliArguments(args) {
  const [command, ...values] = args;

  if (!command || command === "--help" || command === "-h" || command === "help") {
    rejectTrailingArguments(command, values);
    return { command: "help" };
  }
  if (command === "--version" || command === "-v" || command === "version") {
    rejectTrailingArguments(command, values);
    return { command: "version" };
  }
  if (!COMMANDS[command]) throw new CliUsageError(`Unknown command: ${command}`);

  const options = {};
  let target;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value.startsWith("-")) {
      if (!OPTION_NAMES.has(value)) throw new CliUsageError(`Unknown option for ${command}: ${value}`);
      if (!COMMANDS[command].has(value)) throw new CliUsageError(`Option ${value} is not supported by ${command}`);
      if (Object.hasOwn(options, value)) throw new CliUsageError(`Duplicate option for ${command}: ${value}`);

      const optionValue = values[index + 1];
      if (!optionValue || optionValue.startsWith("-")) throw new CliUsageError(`Missing value for ${value}`);
      options[value] = optionValue;
      index += 1;
      continue;
    }

    if (target) throw new CliUsageError(`Unexpected positional argument for ${command}: ${value}`);
    target = value;
  }

  if (!target) {
    const label = command === "replay" ? "fixture path" : "fixture directory";
    throw new CliUsageError(`Missing ${label}`);
  }

  return {
    command,
    target,
    format: options["--format"] ?? "markdown",
    policy: options["--policy"]
  };
}

function rejectTrailingArguments(command, values) {
  if (values.length > 0) {
    throw new CliUsageError(`Unexpected argument for ${command}: ${values[0]}`);
  }
}
