import { retainCandidates } from "../../../scripts/ci-artifacts.mjs";
try {
  const result = await retainCandidates({
    name: process.env.INPUT_NAME,
    targets: process.env.INPUT_TARGETS?.split(",").filter(Boolean) ?? [],
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
