import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the TV relay contract is the exact versioned IPTV Manager handoff", () => {
  const bytes = readFileSync("contracts/remote-relay-v1.json");
  const source = JSON.parse(readFileSync("contracts/remote-relay-source.json", "utf8"));
  const contract = JSON.parse(bytes.toString("utf8"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.sha256);
  expect(source.sourceSha).toMatch(/^[a-f0-9]{40}$/);
  expect(source.repository).toBe("https://git.halvmj.uk/dany/iptv-manager.git");
  expect(source.path).toBe("remote_server/contracts/relay-v1.json");
  expect(contract.protocolVersion).toBe(source.protocolVersion);
  expect(contract.protocolVersion).toBe(1);
  expect(contract.capabilities.transports).toEqual(["websocket", "polling"]);
  expect(contract.phoneOperations).toEqual({ status: "GET", pair: "POST", state: "GET", command: "POST" });
  expect(contract.authentication.ws).toBe("authenticate frame within five seconds");
  expect(contract.limits).toMatchObject({ requestBytes: 65536, inFlight: 8, pollWaitSeconds: 20, heartbeatSeconds: 15, leaseSeconds: 45, keyDeliveryMs: 500, commandDeliveryMs: 2000 });
});
