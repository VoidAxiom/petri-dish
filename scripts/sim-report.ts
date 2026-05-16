import { createSimulationReport, formatSimulationReport } from "../src/simulation/report";

interface CliOptions {
  seed: string;
  generations: number;
  width: number;
  height: number;
  initialPopulation: number;
  json: boolean;
}

const defaults: CliOptions = {
  seed: "mythic-lagoon-17",
  generations: 240,
  width: 56,
  height: 34,
  initialPopulation: 160,
  json: false
};

const options = parseArgs(process.argv.slice(2));
const report = createSimulationReport(options);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatSimulationReport(report));
}

function parseArgs(args: string[]): CliOptions {
  const parsed = { ...defaults };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--seed" && next) {
      parsed.seed = next;
      index += 1;
    } else if (arg === "--generations" && next) {
      parsed.generations = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--width" && next) {
      parsed.width = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--height" && next) {
      parsed.height = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--population" && next) {
      parsed.initialPopulation = Number.parseInt(next, 10);
      index += 1;
    }
  }

  return parsed;
}
