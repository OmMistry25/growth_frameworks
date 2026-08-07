import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { PortOperationError } from "@growth-frameworks/contracts/competitive-footprint";

export interface PublicAddressResolverPort {
  resolve(hostname: string): Promise<readonly LookupAddress[]>;
}

const blockedAddresses = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  if (address.toLowerCase().startsWith("::ffff:")) return false;
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) return !blockedAddresses.check(address, "ipv6");
  return false;
}

export class NodePublicAddressResolver implements PublicAddressResolverPort {
  async resolve(hostname: string): Promise<readonly LookupAddress[]> {
    let addresses: readonly LookupAddress[];
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch (error) {
      throw new PortOperationError("HTTP probe hostname resolution failed", "transient", true, {
        cause: error,
      });
    }

    if (addresses.length === 0) {
      throw new PortOperationError("HTTP probe hostname returned no addresses", "transient", true);
    }
    if (addresses.some(({ address }) => !isPublicAddress(address))) {
      throw new PortOperationError("HTTP probe blocked a non-public destination", "permanent", false);
    }
    return addresses;
  }
}
