import {z} from "zod";

export const LOSS_METHOD = "gbp-compound-poisson-triangular-v1";
export const SIMULATED_YEARS = 10000;
const pounds = z.number().int().min(0).max(1_000_000_000);
export const lossCaseSchema = z.strictObject({
  eventsPerYear: z.number().min(0).max(50),
  low: pounds, likely: pounds, high: pounds,
}).refine(v=>v.low<=v.likely && v.likely<=v.high,{message:"Enter the loss amounts in ascending order."});
export const casesSchema = z.strictObject({before:lossCaseSchema, after:lossCaseSchema.nullable()});
export const saveScenarioSchema = z.strictObject({
  requestKey:z.uuid(), riskVersion:z.number().int().positive(),
  title:z.string().trim().min(3).max(160), assumptions:z.string().trim().min(16).max(1600),
  inputs:casesSchema, evidenceId:z.uuid().nullable(),
});
export type LossCase = z.infer<typeof lossCaseSchema>;
export type LossInputs = z.infer<typeof casesSchema>;

function randomForYear(year: number) {
  let state = (0x51ed270b + Math.imul(year + 1, 0x9e3779b9)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

// Invert the Poisson CDF. An equal uniform draw in both scenarios represents the same year.
function eventCount(rate: number, uniform: number) {
  let probability = Math.exp(-rate), cumulative = probability, count = 0;
  while (cumulative < uniform) {
    count++;
    probability *= rate / count;
    cumulative += probability;
  }
  return count;
}
function severity(input: LossCase, uniform: number) {
  const width = input.high - input.low;
  if (!width) return input.low;
  const split = (input.likely - input.low) / width;
  return uniform < split ? input.low + Math.sqrt(uniform * width * (input.likely - input.low))
    : input.high - Math.sqrt((1-uniform) * width * (input.high - input.likely));
}
function evaluate(input: LossCase) {
  const annual = new Float64Array(SIMULATED_YEARS);
  for (let year=0; year<annual.length; year++) {
    const random = randomForYear(year);
    const count = eventCount(input.eventsPerYear,random());
    for (let event=0; event<count; event++) annual[year] += severity(input,random());
  }
  annual.sort();
  const percentile = (p:number) => Math.round(annual[Math.ceil(p*annual.length)-1]);
  return {
    expected:Math.round(input.eventsPerYear*(input.low+input.likely+input.high)/3),
    median:percentile(0.5), p90:percentile(0.9),
    eventProbability:1-Math.exp(-input.eventsPerYear),
  };
}
export function quantifyLoss(input: LossInputs) {
  const {before,after} = casesSchema.parse(input);
  const baseline = evaluate(before), treated = after ? evaluate(after) : null;
  return {currency:"GBP" as const, method:LOSS_METHOD, years:SIMULATED_YEARS, before:baseline, after:treated,
    expectedReduction:treated ? baseline.expected-treated.expected : null};
}
export type LossResult = ReturnType<typeof quantifyLoss>;
